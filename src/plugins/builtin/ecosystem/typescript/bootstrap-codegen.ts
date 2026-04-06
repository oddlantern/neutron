import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";
import type { ValidatedTokens } from "@/plugins/builtin/domain/design/types";
import { isRecord } from "@/guards";

const HEADER = "// GENERATED — DO NOT EDIT. Changes will be overwritten.\n";

/** Radius values at or above this threshold are treated as pill/full */
const FULL_RADIUS_THRESHOLD = 999;

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Generate SCSS variables from design tokens (Bootstrap-compatible).
 */
export function generateBootstrapScss(tokens: ValidatedTokens): string {
  const { color, spacing, radius } = tokens.standard;
  const lines: string[] = [HEADER];

  // Color variables (light theme as default, dark in a mixin)
  lines.push("// Colors (light theme)");
  for (const [key, entry] of Object.entries(color)) {
    lines.push(`$${camelToKebab(key)}: ${entry.light};`);
  }
  lines.push("");

  // Extension colors
  for (const [, ext] of Object.entries(tokens.extensions)) {
    lines.push(`// ${ext.meta.className}`);
    for (const [fieldName, field] of Object.entries(ext.fields)) {
      lines.push(`$${ext.meta.getter}-${camelToKebab(fieldName)}: ${field.light};`);
    }
    lines.push("");
  }

  // Spacing
  if (Object.keys(spacing).length > 0) {
    lines.push("// Spacing");
    for (const [key, value] of Object.entries(spacing)) {
      lines.push(`$spacing-${camelToKebab(key)}: ${value}px;`);
    }
    lines.push("");
  }

  // Border radius
  if (Object.keys(radius).length > 0) {
    lines.push("// Border radius");
    for (const [key, value] of Object.entries(radius)) {
      const cssValue = value >= FULL_RADIUS_THRESHOLD ? "9999px" : `${value}px`;
      lines.push(`$border-radius-${camelToKebab(key)}: ${cssValue};`);
    }
    lines.push("");
  }

  // Dark theme mixin
  lines.push("// Dark theme overrides");
  lines.push("@mixin dark-theme {");
  for (const [key, entry] of Object.entries(color)) {
    lines.push(`  $${camelToKebab(key)}: ${entry.dark} !global;`);
  }
  for (const [, ext] of Object.entries(tokens.extensions)) {
    for (const [fieldName, field] of Object.entries(ext.fields)) {
      lines.push(`  $${ext.meta.getter}-${camelToKebab(fieldName)}: ${field.dark} !global;`);
    }
  }
  lines.push("}");
  lines.push("");

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

export async function executeBootstrapGeneration(
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

  if (!existsSync(join(outDir, "package.json"))) {
    const workspace = context.graph.name;
    const rawSource = context.sourceName ?? "generated";
    const source = rawSource.replace(/^@[^/]+\//, "");
    const pkgName = workspace ? `@${workspace}/${source}` : source;
    const pkgJson = {
      name: pkgName,
      version: "0.0.0",
      private: true,
      main: "_tokens.scss",
    };
    writeFileSync(join(outDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
  }

  const content = generateBootstrapScss(rawDomainData);
  writeFileSync(join(outDir, "_tokens.scss"), content, "utf-8");

  const colorCount = Object.keys(rawDomainData.standard.color).length;
  return {
    success: true,
    duration: Math.round(performance.now() - start),
    summary: `Bootstrap SCSS generated (${colorCount} colors)`,
  };
}
