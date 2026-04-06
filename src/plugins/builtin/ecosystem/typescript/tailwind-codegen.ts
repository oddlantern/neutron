import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";
import type { ValidatedTokens } from "@/plugins/builtin/domain/design/types";
import { isRecord } from "@/guards";

const CSS_HEADER = "/* GENERATED — DO NOT EDIT. Changes will be overwritten. */\n";
const TS_HEADER = "/* GENERATED — DO NOT EDIT. Changes will be overwritten. */\n";

/** Radius values at or above this threshold are treated as pill/full */
const FULL_RADIUS_THRESHOLD = 999;

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Generate Tailwind v4 CSS theme file using @theme directive.
 *
 * Tailwind v4 is CSS-first — theme values are defined as CSS custom properties
 * inside `@theme { }` blocks. No tailwind.config.ts needed.
 *
 * Output: imported via `@import "./tokens.tailwind.css"` in the app's main CSS.
 */
export function generateTailwindCSS(tokens: ValidatedTokens): string {
  const { color, spacing, radius, iconSize } = tokens.standard;
  const lines: string[] = [CSS_HEADER];

  lines.push("@theme {");

  // Colors
  for (const [key, entry] of Object.entries(color)) {
    lines.push(`  --color-${camelToKebab(key)}: ${entry.light};`);
  }

  // Extension colors
  for (const [, ext] of Object.entries(tokens.extensions)) {
    lines.push("");
    for (const [fieldName, field] of Object.entries(ext.fields)) {
      lines.push(`  --color-${ext.meta.getter}-${camelToKebab(fieldName)}: ${field.light};`);
    }
  }

  // Spacing
  if (Object.keys(spacing).length > 0) {
    lines.push("");
    for (const [key, value] of Object.entries(spacing)) {
      lines.push(`  --spacing-${camelToKebab(key)}: ${value}px;`);
    }
  }

  // Border radius
  if (Object.keys(radius).length > 0) {
    lines.push("");
    for (const [key, value] of Object.entries(radius)) {
      const cssValue = value >= FULL_RADIUS_THRESHOLD ? "9999px" : `${value}px`;
      lines.push(`  --radius-${camelToKebab(key)}: ${cssValue};`);
    }
  }

  // Icon sizes as custom spacing
  if (Object.keys(iconSize).length > 0) {
    lines.push("");
    for (const [key, value] of Object.entries(iconSize)) {
      lines.push(`  --size-icon-${camelToKebab(key)}: ${value}px;`);
    }
  }

  lines.push("}");
  lines.push("");

  // Dark theme overrides via media query
  lines.push("@media (prefers-color-scheme: dark) {");
  lines.push("  @theme {");
  for (const [key, entry] of Object.entries(color)) {
    lines.push(`    --color-${camelToKebab(key)}: ${entry.dark};`);
  }
  for (const [, ext] of Object.entries(tokens.extensions)) {
    for (const [fieldName, field] of Object.entries(ext.fields)) {
      lines.push(`    --color-${ext.meta.getter}-${camelToKebab(fieldName)}: ${field.dark};`);
    }
  }
  lines.push("  }");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate TypeScript constants alongside the CSS (for programmatic access).
 */
export function generateTailwindTS(tokens: ValidatedTokens): string {
  const { spacing, radius, iconSize } = tokens.standard;
  const lines: string[] = [TS_HEADER];

  if (Object.keys(spacing).length > 0) {
    lines.push("export const DSSpacing = {");
    for (const [key, value] of Object.entries(spacing)) {
      lines.push(`  ${key}: ${value},`);
    }
    lines.push("} as const;");
    lines.push("");
  }

  if (Object.keys(radius).length > 0) {
    lines.push("export const DSRadius = {");
    for (const [key, value] of Object.entries(radius)) {
      lines.push(`  ${key}: ${value},`);
    }
    lines.push("} as const;");
    lines.push("");
  }

  if (Object.keys(iconSize).length > 0) {
    lines.push("export const DSIconSize = {");
    for (const [key, value] of Object.entries(iconSize)) {
      lines.push(`  ${key}: ${value},`);
    }
    lines.push("} as const;");
    lines.push("");
  }

  return lines.join("\n");
}

function isValidatedTokens(value: unknown): value is ValidatedTokens {
  if (!isRecord(value)) {
    return false;
  }
  if (!isRecord(value["standard"])) {
    return false;
  }
  return typeof value["standard"]["color"] === "object" && value["standard"]["color"] !== null;
}

export async function executeTailwindGeneration(
  _pkg: WorkspacePackage,
  _root: string,
  context: ExecutionContext,
): Promise<ExecuteResult> {
  const start = performance.now();

  const rawDomainData = context.domainData;
  if (!isValidatedTokens(rawDomainData)) {
    return {
      success: false,
      duration: 0,
      summary: "No token data provided — design plugin must validate first",
    };
  }

  const outDir = context.outputDir ?? join(_root, _pkg.path, "generated");
  mkdirSync(outDir, { recursive: true });

  // Scaffold package.json if first run
  if (!existsSync(join(outDir, "package.json"))) {
    const workspace = context.graph.name;
    const rawSource = context.sourceName ?? "generated";
    const source = rawSource.replace(/^@[^/]+\//, "");
    const pkgName = workspace ? `@${workspace}/${source}` : source;
    const pkgJson = {
      name: pkgName,
      version: "0.0.0",
      private: true,
      main: "tokens.tailwind.css",
    };
    writeFileSync(join(outDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
  }

  const cssContent = generateTailwindCSS(rawDomainData);
  const tsContent = generateTailwindTS(rawDomainData);
  writeFileSync(join(outDir, "tokens.tailwind.css"), cssContent, "utf-8");
  writeFileSync(join(outDir, "tokens.ts"), tsContent, "utf-8");

  const colorCount = Object.keys(rawDomainData.standard.color).length;
  return {
    success: true,
    duration: Math.round(performance.now() - start),
    summary: `Tailwind v4 theme generated (${colorCount} colors)`,
  };
}
