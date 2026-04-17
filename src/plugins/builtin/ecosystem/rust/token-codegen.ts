import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type { ValidatedTokens } from "@/plugins/builtin/domain/design/types";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";

const HEADER = "// GENERATED — DO NOT EDIT. Changes will be overwritten.";

/** Convert camelCase to SCREAMING_SNAKE_CASE for Rust module consts. */
function toConstName(str: string): string {
  return str
    .replace(/[A-Z]/g, (letter, idx: number) =>
      idx > 0 ? `_${letter.toLowerCase()}` : letter.toLowerCase(),
    )
    .toUpperCase();
}

/** Convert camelCase to snake_case for Rust struct fields. */
function toFieldName(str: string): string {
  return str.replace(/[A-Z]/g, (letter, idx: number) =>
    idx > 0 ? `_${letter.toLowerCase()}` : letter.toLowerCase(),
  );
}

/** Narrow unknown domainData to ValidatedTokens at the boundary. */
function isValidatedTokens(value: unknown): value is ValidatedTokens {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { standard?: { color?: unknown } };
  return (
    typeof candidate.standard === "object" &&
    candidate.standard !== null &&
    typeof candidate.standard.color === "object"
  );
}

/**
 * Generate a Rust module with design token constants.
 *
 * Shape:
 *   - `pub mod spacing` / `radius` / `icon_size` — flat `pub const` values
 *   - `pub struct Color` with `const LIGHT`/`DARK` instances — typed
 *     bundle of hex color strings
 *   - One `pub struct` + `LIGHT`/`DARK` consts per custom extension
 *
 * Using `pub const` (not static) keeps values in the .rodata section
 * and makes them usable in const contexts. Hex colors are stored as
 * `&'static str` because parsing them to `[u8; 4]` at const-init time
 * requires nightly const fn and isn't worth the complexity.
 */
export function generateTokensModule(tokens: ValidatedTokens): string {
  const { color, spacing, radius, iconSize } = tokens.standard;
  const lines: string[] = [HEADER, ""];

  // Color as a typed struct with themed const instances.
  if (Object.keys(color).length > 0) {
    const colorFields = Object.entries(color);
    lines.push("pub struct Color {");
    for (const [name] of colorFields) {
      lines.push(`    pub ${toFieldName(name)}: &'static str,`);
    }
    lines.push("}");
    lines.push("");

    lines.push("impl Color {");
    for (const theme of ["LIGHT", "DARK"] as const) {
      const key = theme.toLowerCase() as "light" | "dark";
      lines.push(`    pub const ${theme}: Color = Color {`);
      for (const [name, entry] of colorFields) {
        lines.push(`        ${toFieldName(name)}: "${entry[key]}",`);
      }
      lines.push(`    };`);
    }
    lines.push("}");
    lines.push("");
  }

  // Spacing / radius / icon_size — flat u32 consts in modules.
  const scalarSections = [
    { name: "spacing", entries: Object.entries(spacing) },
    { name: "radius", entries: Object.entries(radius) },
    { name: "icon_size", entries: Object.entries(iconSize) },
  ];
  for (const section of scalarSections) {
    if (section.entries.length === 0) continue;
    lines.push(`pub mod ${section.name} {`);
    for (const [name, value] of section.entries) {
      lines.push(`    pub const ${toConstName(name)}: u32 = ${String(value)};`);
    }
    lines.push(`}`);
    lines.push("");
  }

  // Extensions — one struct + theme consts per section.
  for (const [, ext] of Object.entries(tokens.extensions)) {
    const fieldNames = Object.keys(ext.fields);
    if (fieldNames.length === 0) continue;

    lines.push(`pub struct ${ext.meta.className} {`);
    for (const name of fieldNames) {
      lines.push(`    pub ${toFieldName(name)}: &'static str,`);
    }
    lines.push("}");
    lines.push("");

    lines.push(`impl ${ext.meta.className} {`);
    for (const theme of ["LIGHT", "DARK"] as const) {
      const key = theme.toLowerCase() as "light" | "dark";
      lines.push(`    pub const ${theme}: ${ext.meta.className} = ${ext.meta.className} {`);
      for (const name of fieldNames) {
        const field = ext.fields[name];
        if (!field) continue;
        lines.push(`        ${toFieldName(name)}: "${field[key]}",`);
      }
      lines.push(`    };`);
    }
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Scaffold a Rust package layout for the generated tokens:
 *   - Cargo.toml (minimal, no external deps)
 *   - src/lib.rs re-exporting the tokens module
 *   - src/tokens.rs with the generated content
 */
export function executeTokenGeneration(
  _pkg: WorkspacePackage,
  _root: string,
  context: ExecutionContext,
): ExecuteResult {
  const start = performance.now();

  if (!isValidatedTokens(context.domainData)) {
    return {
      success: false,
      duration: 0,
      summary: "No validated tokens in context.domainData",
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

  const srcDir = join(outDir, "src");
  mkdirSync(srcDir, { recursive: true });

  const content = generateTokensModule(context.domainData);
  writeFileSync(join(srcDir, "tokens.rs"), content, "utf-8");

  // lib.rs re-exports tokens module so consumers can `use <crate>::Color;`
  const libPath = join(srcDir, "lib.rs");
  if (!existsSync(libPath)) {
    writeFileSync(
      libPath,
      [HEADER, "", "pub mod tokens;", "pub use tokens::*;", ""].join("\n"),
      "utf-8",
    );
  }

  // Cargo.toml — only scaffold if missing. Preserves user edits.
  const cargoPath = join(outDir, "Cargo.toml");
  if (!existsSync(cargoPath)) {
    const workspace = context.graph.name;
    const sourceName = context.sourceName ?? "tokens";
    // Cargo crate names use snake_case or kebab-case; underscore is
    // idiomatic for library crates.
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
        'description = "Generated design tokens — do not edit"',
        "",
        "[lib]",
        'path = "src/lib.rs"',
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  return {
    success: true,
    duration: Math.round(performance.now() - start),
    summary: `tokens.rs written to ${outDir}`,
  };
}
