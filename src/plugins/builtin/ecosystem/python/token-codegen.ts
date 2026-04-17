import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type { ValidatedTokens } from "@/plugins/builtin/domain/design/types";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";

const HEADER = '"""GENERATED — DO NOT EDIT. Changes will be overwritten."""';

/** Radius values at or above this threshold are emitted as "full" — pill shapes. */
const FULL_RADIUS_THRESHOLD = 999;

/** Convert camelCase to snake_case (Python idiom) */
function toSnake(str: string): string {
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
 * Generate a Python module with design token constants.
 *
 * Shape:
 *   - `ColorLight` / `ColorDark` — frozen dataclasses of color hex strings
 *   - `Spacing` / `Radius` / `IconSize` — frozen dataclasses of pixel values (int)
 *   - Extension classes — one per custom extension, with light/dark classmethods
 *
 * Frozen dataclasses are both immutable (safe to share) and directly
 * usable in type annotations.
 */
export function generateTokensModule(tokens: ValidatedTokens): string {
  const { color, spacing, radius, iconSize } = tokens.standard;
  const lines: string[] = [HEADER, "", "from dataclasses import dataclass", ""];

  // Color — one dataclass per theme.
  if (Object.keys(color).length > 0) {
    const colorFields = Object.entries(color);
    for (const theme of ["Light", "Dark"] as const) {
      const key = theme.toLowerCase() as "light" | "dark";
      lines.push("@dataclass(frozen=True)");
      lines.push(`class Color${theme}:`);
      for (const [name, entry] of colorFields) {
        lines.push(`    ${toSnake(name)}: str = "${entry[key]}"`);
      }
      lines.push("");
    }
  }

  // Spacing — integer px values.
  if (Object.keys(spacing).length > 0) {
    lines.push("@dataclass(frozen=True)");
    lines.push("class Spacing:");
    for (const [name, value] of Object.entries(spacing)) {
      lines.push(`    ${toSnake(name)}: int = ${String(value)}`);
    }
    lines.push("");
  }

  // Radius — integer px; large values become floats signaling "full".
  if (Object.keys(radius).length > 0) {
    lines.push("@dataclass(frozen=True)");
    lines.push("class Radius:");
    for (const [name, value] of Object.entries(radius)) {
      const annotated = value >= FULL_RADIUS_THRESHOLD ? "float" : "int";
      lines.push(`    ${toSnake(name)}: ${annotated} = ${String(value)}`);
    }
    lines.push("");
  }

  // Icon size — integer px.
  if (Object.keys(iconSize).length > 0) {
    lines.push("@dataclass(frozen=True)");
    lines.push("class IconSize:");
    for (const [name, value] of Object.entries(iconSize)) {
      lines.push(`    ${toSnake(name)}: int = ${String(value)}`);
    }
    lines.push("");
  }

  // Extensions — each becomes a dataclass with .light() and .dark() factories.
  for (const [, ext] of Object.entries(tokens.extensions)) {
    const className = ext.meta.className;
    const fieldNames = Object.keys(ext.fields);
    if (fieldNames.length === 0) continue;

    lines.push("@dataclass(frozen=True)");
    lines.push(`class ${className}:`);
    for (const name of fieldNames) {
      lines.push(`    ${toSnake(name)}: str`);
    }
    lines.push("");

    for (const theme of ["light", "dark"] as const) {
      const suffix = theme === "light" ? "Light" : "Dark";
      lines.push("@dataclass(frozen=True)");
      lines.push(`class ${className}${suffix}(${className}):`);
      for (const name of fieldNames) {
        const field = ext.fields[name];
        if (!field) continue;
        lines.push(`    ${toSnake(name)}: str = "${field[theme]}"`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Write the generated tokens module to the output directory and
 * scaffold a minimal pyproject.toml if one isn't there yet.
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

  mkdirSync(outDir, { recursive: true });

  const content = generateTokensModule(context.domainData);
  writeFileSync(join(outDir, "tokens.py"), content, "utf-8");

  // Scaffold pyproject.toml so the output directory is a proper package.
  const pyproject = join(outDir, "pyproject.toml");
  if (!existsSync(pyproject)) {
    const workspace = context.graph.name;
    const sourceName = context.sourceName ?? "tokens";
    const pkgName = workspace ? `${workspace}_${sourceName}` : sourceName;
    writeFileSync(
      pyproject,
      [
        "[project]",
        `name = "${pkgName}"`,
        'version = "0.0.0"',
        'description = "Generated design tokens — do not edit"',
        "dependencies = []",
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  return {
    success: true,
    duration: Math.round(performance.now() - start),
    summary: `tokens.py written to ${outDir}`,
  };
}
