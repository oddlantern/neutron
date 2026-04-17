import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import { isRecord } from "@/guards";
import { generateGo } from "@/plugins/builtin/ecosystem/go/schema-codegen";
import { validateSchema } from "@/plugins/builtin/domain/schema/plugin";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";

/**
 * Header shipped with every generated file. Keeps the "why no full
 * client" rationale visible in the code itself, same as Rust — future
 * contributors open models.go before they read docs.
 */
const MODELS_HEADER = [
  "// GENERATED — DO NOT EDIT. Changes will be overwritten.",
  "//",
  "// Go OpenAPI codegen is types-only: we emit the structs from",
  "// components.schemas and leave the HTTP client to you. This matches",
  "// how the Go ecosystem consumes APIs — thin wrappers over net/http",
  "// or resty that you write once and own end-to-end, rather than a",
  "// generated client that locks you into someone else's abstractions.",
  "//",
  "// If you need a full client generator, openapi-generator-cli or",
  "// oapi-codegen cover that use case separately.",
  "",
  "package models",
  "",
].join("\n");

/**
 * Generate a Go `models.go` file from an OpenAPI spec's
 * components.schemas section. Reuses the JSON Schema validator
 * because components.schemas IS JSON Schema under a different key.
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
    return { success: false, duration: 0, summary: "No outputDir provided" };
  }

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

  // Extract components.schemas and wrap as $defs for the validator.
  const components = isRecord(spec["components"]) ? spec["components"] : null;
  const schemas = components && isRecord(components["schemas"]) ? components["schemas"] : {};

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

  mkdirSync(outDir, { recursive: true });

  // generateGo emits its own header with `package schema`. For
  // OpenAPI we want `package models` and the types-only rationale
  // instead — prepend our header and strip generateGo's.
  const structsOnly = generateGo(validation.data)
    .replace(/^\/\/ GENERATED[\s\S]*?package schema\n/, "")
    .trim();

  writeFileSync(join(outDir, "models.go"), MODELS_HEADER + structsOnly + "\n", "utf-8");

  // go.mod scaffold. No runtime deps — models.go uses only stdlib.
  const goModPath = join(outDir, "go.mod");
  if (!existsSync(goModPath)) {
    const workspace = context.graph.name;
    const sourceName = context.sourceName ?? "client";
    const modulePath = (workspace ? `${workspace}/${sourceName}` : sourceName).replace(
      /[^a-zA-Z0-9._/-]/g,
      "_",
    );
    writeFileSync(goModPath, [`module ${modulePath}`, "", "go 1.21", ""].join("\n"), "utf-8");
  }

  const count = validation.data.definitions.length;
  return {
    success: true,
    duration: Math.round(performance.now() - start),
    summary: `${String(count)} Go struct(s) generated — models only (write a thin client over net/http or resty)`,
  };
}
