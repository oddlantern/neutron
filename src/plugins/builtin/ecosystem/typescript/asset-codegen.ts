import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";
import { isRecord } from "@/plugins/builtin/shared/exec";
import type { AssetManifest } from "@/plugins/builtin/domain/assets/types";

const HEADER = "/* GENERATED — DO NOT EDIT. Changes will be overwritten. */";

/** Maximum SVG file size (bytes) to inline. Larger files are skipped. */
const MAX_INLINE_SIZE = 64 * 1024;

/**
 * Convert a key to a valid TypeScript identifier (camelCase).
 * Keys starting with a digit get a `$` prefix.
 */
function toCamelCase(str: string): string {
  const parts = str.split(/[_\-]/).filter((p) => p.length > 0);
  if (parts.length === 0) {
    return str;
  }
  const first = parts[0] ?? "";
  const rest = parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  const result = first + rest.join("");
  if (/^\d/.test(result)) {
    return `$${result}`;
  }
  return result;
}

/**
 * Convert a category name to PascalCase.
 */
function toPascalCase(str: string): string {
  return str
    .split(/[_\-]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Escape a string for safe embedding in a single-quoted JS string.
 */
function escapeSingleQuoted(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Escape content for safe embedding in a template literal.
 * Order matters: backslashes first, then backticks, then ${}.
 */
function escapeTemplateLiteral(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/**
 * Narrow unknown domainData to AssetManifest.
 */
function isAssetManifest(value: unknown): value is AssetManifest {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["workspaceName"] === "string" &&
    Array.isArray(value["categories"]) &&
    Array.isArray(value["allEntries"])
  );
}

/**
 * Generate TypeScript exports for an assets package.
 *
 * Two output files:
 * - `paths.ts` — Typed path constants for each asset
 * - `inline.ts` — Inlined SVG content as template literal strings (< 64KB only)
 */
export async function executeTypescriptAssetGeneration(
  _pkg: WorkspacePackage,
  root: string,
  context: ExecutionContext,
): Promise<ExecuteResult> {
  const start = performance.now();

  if (!isAssetManifest(context.domainData)) {
    return {
      success: false,
      duration: 0,
      summary: "No asset manifest provided — assets plugin must scan first",
    };
  }

  const manifest = context.domainData;
  const outDir = context.outputDir;
  if (!outDir) {
    return {
      success: false,
      duration: 0,
      summary: "No outputDir provided",
    };
  }

  mkdirSync(outDir, { recursive: true });

  const sourcePath = context.artifactPath;
  const sourceDir = sourcePath ? join(root, sourcePath) : null;

  // ─── Generate path constants ──────────────────────────────────────────────
  const pathLines: string[] = [HEADER, ""];
  let hasPathContent = false;

  for (const category of manifest.categories) {
    if (category.entries.length === 0) {
      continue;
    }
    hasPathContent = true;

    const constName = `${toPascalCase(category.name)}Paths`;
    pathLines.push(`export const ${constName} = {`);

    for (const entry of category.entries) {
      const key = toCamelCase(entry.key);
      pathLines.push(`  ${key}: '${escapeSingleQuoted(entry.relativePath)}',`);
    }

    pathLines.push("} as const;");
    pathLines.push("");
    pathLines.push(`export type ${toPascalCase(category.name)}Key = keyof typeof ${constName};`);
    pathLines.push("");
  }

  if (hasPathContent) {
    writeFileSync(join(outDir, "paths.ts"), pathLines.join("\n"), "utf-8");
  }

  // ─── Generate inlined SVG content ─────────────────────────────────────────
  const svgEntries = manifest.allEntries.filter((e) => e.ext === "svg");
  let inlinedCount = 0;
  let skippedCount = 0;

  if (svgEntries.length > 0 && sourceDir) {
    const inlineLines: string[] = [HEADER, ""];

    for (const category of manifest.categories) {
      const svgInCategory = category.entries.filter((e) => e.ext === "svg");
      if (svgInCategory.length === 0) {
        continue;
      }

      const constName = `${toPascalCase(category.name)}Svg`;
      const entries: string[] = [];

      for (const entry of svgInCategory) {
        const absPath = join(sourceDir, entry.relativePath);
        if (!existsSync(absPath)) {
          continue;
        }
        const content = readFileSync(absPath, "utf-8");
        if (content.length > MAX_INLINE_SIZE) {
          skippedCount++;
          continue;
        }
        const key = toCamelCase(entry.key);
        const escaped = escapeTemplateLiteral(content.trim());
        entries.push(`  ${key}: \`${escaped}\`,`);
        inlinedCount++;
      }

      if (entries.length > 0) {
        inlineLines.push(`export const ${constName} = {`);
        inlineLines.push(...entries);
        inlineLines.push("} as const;");
        inlineLines.push("");
      }
    }

    if (inlinedCount > 0) {
      writeFileSync(join(outDir, "inline.ts"), inlineLines.join("\n"), "utf-8");
    }
  }

  // ─── Scaffold package.json ────────────────────────────────────────────────
  const workspace = context.graph.name;
  const rawSource = (context.sourceName ?? "assets").replace(/^@[^/]+\//, "");
  const pkgName = workspace ? `@${workspace}/${rawSource}` : rawSource;

  const exports: Record<string, string> = { ".": "./index.ts" };
  if (hasPathContent) {
    exports["./paths"] = "./paths.ts";
  }
  if (inlinedCount > 0) {
    exports["./inline"] = "./inline.ts";
  }

  const pkgJson = {
    name: pkgName,
    version: "0.0.0",
    private: true,
    main: "index.ts",
    exports,
  };
  writeFileSync(join(outDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");

  // ─── Generate barrel index.ts ─────────────────────────────────────────────
  const indexLines: string[] = [HEADER, ""];
  if (hasPathContent) {
    indexLines.push("export * from './paths';");
  }
  if (inlinedCount > 0) {
    indexLines.push("export * from './inline';");
  }
  indexLines.push("");
  writeFileSync(join(outDir, "index.ts"), indexLines.join("\n"), "utf-8");

  const duration = Math.round(performance.now() - start);
  const fileCount = 2 + (inlinedCount > 0 ? 1 : 0);
  const skippedNote = skippedCount > 0 ? `, ${skippedCount} SVGs skipped (>${MAX_INLINE_SIZE / 1024}KB)` : "";
  return {
    success: true,
    duration,
    summary: `${fileCount} file(s) written (${manifest.allEntries.length} paths, ${inlinedCount} inlined SVGs${skippedNote})`,
  };
}
