import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type { ValidatedTokens } from "@/plugins/builtin/domain/design/types";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";

const HEADER = "// GENERATED — DO NOT EDIT. Changes will be overwritten.";

/** Convert camelCase / snake_case to PascalCase (Go exported identifier). */
function toPascal(str: string): string {
  // Split on common boundaries and capitalize each part
  const parts = str
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .split(/[-_]/)
    .filter((p) => p.length > 0);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("");
}

/** Narrow unknown domainData to ValidatedTokens at the boundary. */
function isValidatedTokens(value: unknown): value is ValidatedTokens {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { standard?: { color?: unknown } };
  return (
    typeof candidate.standard === "object" &&
    candidate.standard !== null &&
    typeof candidate.standard.color === "object"
  );
}

/** Longest field name in a group, for aligned struct literals. */
function longest(names: readonly string[]): number {
  return names.reduce((m, n) => Math.max(m, n.length), 0);
}

/**
 * Generate a Go module with design token constants.
 *
 * Shape:
 *   - `type Color struct { ... }` + `var ColorLight`, `var ColorDark`
 *   - `const (SpacingXs = 4; ...)` for Spacing, Radius, IconSize
 *   - Per-extension struct + Light/Dark vars
 *
 * Theme instances are `var` rather than `const` because Go only allows
 * `const` on basic types — struct values can't be const in Go.
 */
export function generateTokensModule(tokens: ValidatedTokens): string {
  const { color, spacing, radius, iconSize } = tokens.standard;
  const lines: string[] = [HEADER, "", "package tokens", ""];

  // Color struct + themed var instances.
  const colorFields = Object.entries(color);
  if (colorFields.length > 0) {
    const pascalNames = colorFields.map(([name]) => toPascal(name));
    const maxName = longest(pascalNames);

    lines.push("type Color struct {");
    for (const name of pascalNames) {
      lines.push(`\t${name.padEnd(maxName)} string`);
    }
    lines.push("}");
    lines.push("");

    for (const theme of ["Light", "Dark"] as const) {
      const key = theme.toLowerCase() as "light" | "dark";
      lines.push(`var Color${theme} = Color{`);
      for (const [i, [, entry]] of colorFields.entries()) {
        const pname = pascalNames[i] ?? "Unknown";
        // gofmt aligns values, not names — pad after the colon.
        lines.push(`\t${(pname + ":").padEnd(maxName + 1)} "${entry[key]}",`);
      }
      lines.push("}");
      lines.push("");
    }
  }

  // Scalar sections: Spacing, Radius, IconSize — emit as const blocks
  // with prefixed names (Go doesn't nest consts under a namespace the
  // way Rust does with pub mod).
  const scalarGroups = [
    { prefix: "Spacing", entries: Object.entries(spacing) },
    { prefix: "Radius", entries: Object.entries(radius) },
    { prefix: "IconSize", entries: Object.entries(iconSize) },
  ];
  for (const group of scalarGroups) {
    if (group.entries.length === 0) continue;
    lines.push("const (");
    const pascalNames = group.entries.map(([name]) => `${group.prefix}${toPascal(name)}`);
    const maxName = longest(pascalNames);
    for (const [i, [, value]] of group.entries.entries()) {
      const name = pascalNames[i] ?? `${group.prefix}Unknown`;
      lines.push(`\t${name.padEnd(maxName)} uint32 = ${String(value)}`);
    }
    lines.push(")");
    lines.push("");
  }

  // Extensions — struct + Light/Dark vars.
  for (const [, ext] of Object.entries(tokens.extensions)) {
    const fieldNames = Object.keys(ext.fields);
    if (fieldNames.length === 0) continue;

    const pascalNames = fieldNames.map((n) => toPascal(n));
    const maxName = longest(pascalNames);
    const className = ext.meta.className;

    lines.push(`type ${className} struct {`);
    for (const name of pascalNames) {
      lines.push(`\t${name.padEnd(maxName)} string`);
    }
    lines.push("}");
    lines.push("");

    for (const theme of ["Light", "Dark"] as const) {
      const key = theme.toLowerCase() as "light" | "dark";
      lines.push(`var ${className}${theme} = ${className}{`);
      for (const [i, name] of fieldNames.entries()) {
        const pname = pascalNames[i] ?? "Unknown";
        const field = ext.fields[name];
        if (!field) continue;
        lines.push(`\t${(pname + ":").padEnd(maxName + 1)} "${field[key]}",`);
      }
      lines.push("}");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Scaffold a Go module layout:
 *   - go.mod with a neutron-generated module name
 *   - tokens.go with the generated source (package tokens)
 */
export function executeTokenGeneration(
  _pkg: WorkspacePackage,
  _root: string,
  context: ExecutionContext,
): ExecuteResult {
  const start = performance.now();

  if (!isValidatedTokens(context.domainData)) {
    return { success: false, duration: 0, summary: "No validated tokens in context.domainData" };
  }

  const outDir = context.outputDir;
  if (!outDir) {
    return { success: false, duration: 0, summary: "No outputDir provided" };
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "tokens.go"), generateTokensModule(context.domainData), "utf-8");

  // go.mod scaffold. The module path is workspace/sourceName; sanitized
  // so weird characters don't break Go's module-path syntax.
  const goModPath = join(outDir, "go.mod");
  if (!existsSync(goModPath)) {
    const workspace = context.graph.name;
    const sourceName = context.sourceName ?? "tokens";
    // Go module paths allow letters, digits, `.`, `-`, `_`, `/`.
    const modulePath = (workspace ? `${workspace}/${sourceName}` : sourceName).replace(
      /[^a-zA-Z0-9._/-]/g,
      "_",
    );
    writeFileSync(goModPath, [`module ${modulePath}`, "", "go 1.21", ""].join("\n"), "utf-8");
  }

  return {
    success: true,
    duration: Math.round(performance.now() - start),
    summary: `tokens.go written to ${outDir}`,
  };
}
