import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import { isRecord } from "@/guards";
import { generateRust } from "@/plugins/builtin/ecosystem/rust/schema-codegen";
import { validateSchema } from "@/plugins/builtin/domain/schema/plugin";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";

/**
 * Explanatory header shipped with every generated file. Keeps the
 * "why no full client" rationale visible in the code itself, not just
 * in docs — future contributors will open the file first.
 */
const MODELS_HEADER = [
  "// GENERATED — DO NOT EDIT. Changes will be overwritten.",
  "//",
  "// Rust OpenAPI codegen is types-only: we emit the structs from",
  "// components.schemas and leave the HTTP client to you. This matches",
  "// how the Rust ecosystem consumes APIs — thin wrappers over reqwest,",
  "// hyper, or ureq that you write once and own end-to-end, rather than",
  "// a generated client that locks you into someone else's abstractions.",
  "//",
  "// If you need a full client generator, openapi-generator-cli or",
  "// progenitor cover that use case separately.",
  "",
  "use serde::{Deserialize, Serialize};",
  "",
].join("\n");

/**
 * Generate a Rust `models.rs` file from an OpenAPI spec's
 * components.schemas section. Reuses the JSON Schema validator
 * because components.schemas is just JSON Schema under a different
 * parent key.
 */
export async function executeOpenapiModelGeneration(
  _pkg: WorkspacePackage,
  root: string,
  context: ExecutionContext,
): Promise<ExecuteResult> {
  const start = performance.now();

  const artifactPath = context.artifactPath;
  if (!artifactPath) {
    return {
      success: false,
      duration: 0,
      summary: "No artifactPath set — openapi domain must run before codegen",
    };
  }

  const outDir = context.outputDir;
  if (!outDir) {
    return {
      success: false,
      duration: 0,
      summary: "No outputDir provided",
    };
  }

  // Read and parse the spec.
  const specPath = resolve(root, artifactPath);
  let spec: unknown;
  try {
    const raw = await readFile(specPath, "utf-8");
    spec = JSON.parse(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      duration: Math.round(performance.now() - start),
      summary: `Failed to read OpenAPI spec: ${msg}`,
    };
  }

  if (!isRecord(spec)) {
    return {
      success: false,
      duration: Math.round(performance.now() - start),
      summary: "OpenAPI spec must be a JSON object",
    };
  }

  // Extract components.schemas. Empty is legal but means "no models to
  // generate" — emit an empty module rather than failing.
  const components = isRecord(spec["components"]) ? spec["components"] : null;
  const schemas = components && isRecord(components["schemas"]) ? components["schemas"] : {};

  // Wrap as { $defs: <schemas> } so validateSchema treats each entry
  // as a type definition.
  const validation = validateSchema({ $defs: schemas });
  if (!validation.success || !validation.data) {
    const errorLines = validation.errors.map((e) => `  ${e.path}: ${e.message}`).join("\n");
    return {
      success: false,
      duration: Math.round(performance.now() - start),
      summary: `OpenAPI components.schemas failed validation (${String(validation.errors.length)} errors)`,
      output: errorLines,
    };
  }

  const srcDir = join(outDir, "src");
  mkdirSync(srcDir, { recursive: true });

  // generateRust emits its own header with the JSON-Schema rationale.
  // For OpenAPI we want the "types-only by convention" framing
  // instead, so prepend our header and strip generateRust's.
  const structsOnly = generateRust(validation.data)
    .replace(/^\/\/ GENERATED[\s\S]*?use serde::[^\n]*\n/, "")
    .trim();

  writeFileSync(join(srcDir, "models.rs"), MODELS_HEADER + "\n" + structsOnly + "\n", "utf-8");

  // lib.rs re-exports the models so consumers `use <crate>::User;`.
  const libPath = join(srcDir, "lib.rs");
  if (!existsSync(libPath)) {
    writeFileSync(
      libPath,
      [
        "// GENERATED — DO NOT EDIT. Changes will be overwritten.",
        "",
        "pub mod models;",
        "pub use models::*;",
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  // Cargo.toml scaffold. Depends on serde + serde_json (the only
  // runtime deps the emitted code uses).
  const cargoPath = join(outDir, "Cargo.toml");
  if (!existsSync(cargoPath)) {
    const workspace = context.graph.name;
    const sourceName = context.sourceName ?? "client";
    const crateName = (workspace ? `${workspace}_${sourceName}` : sourceName).replace(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );
    writeFileSync(
      cargoPath,
      [
        "[package]",
        `name = "${crateName}"`,
        'version = "0.0.0"',
        'edition = "2021"',
        'description = "Generated OpenAPI models (types only) — do not edit"',
        "",
        "[dependencies]",
        'serde = { version = "1", features = ["derive"] }',
        'serde_json = "1"',
        "",
        "[lib]",
        'path = "src/lib.rs"',
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  const count = validation.data.definitions.length;
  return {
    success: true,
    duration: Math.round(performance.now() - start),
    summary: `${String(count)} Rust struct(s) generated — models only (write a thin client over reqwest/hyper)`,
  };
}
