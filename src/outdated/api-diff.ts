import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { TypeDiff } from "@/outdated/types";

// ── TypeScript export extraction ─────────────────────────────────────

/**
 * Regex patterns for extracting named exports from .d.ts files.
 * Covers: export function, export const, export class, export interface,
 * export type, export enum, and export { name } re-exports.
 */
const TS_EXPORT_DECL_RE = /export\s+(?:declare\s+)?(?:function|const|let|var|class|interface|type|enum|abstract\s+class)\s+(\w+)/g;
const TS_EXPORT_LIST_RE = /export\s*\{([^}]+)\}/g;
const TS_DEFAULT_EXPORT_RE = /export\s+default\s+(?:function|class|abstract\s+class)\s+(\w+)/g;

/**
 * Extract exported symbol names from TypeScript declaration (.d.ts) content.
 * This is a heuristic regex-based approach — not a full TS parser.
 */
export function extractTypescriptExports(dtsContent: string): readonly string[] {
  const exports = new Set<string>();

  // Named declarations: export (declare) function/const/class/etc Name
  for (const match of dtsContent.matchAll(TS_EXPORT_DECL_RE)) {
    if (match[1]) {
      exports.add(match[1]);
    }
  }

  // Re-export lists: export { Foo, Bar, Baz as Qux }
  for (const match of dtsContent.matchAll(TS_EXPORT_LIST_RE)) {
    if (match[1]) {
      for (const item of match[1].split(",")) {
        const trimmed = item.trim();
        // "Foo as Bar" → take "Bar" (the exported name)
        const parts = trimmed.split(/\s+as\s+/);
        const name = (parts[1] ?? parts[0])?.trim();
        if (name && name.length > 0) {
          exports.add(name);
        }
      }
    }
  }

  // Default export with name: export default class Foo
  for (const match of dtsContent.matchAll(TS_DEFAULT_EXPORT_RE)) {
    if (match[1]) {
      exports.add(match[1]);
    }
  }

  return [...exports].sort();
}

// ── Dart export extraction ───────────────────────────────────────────

/**
 * Regex patterns for extracting public API surface from Dart source files.
 * Excludes private names (prefixed with _).
 */
const DART_CLASS_RE = /^(?:abstract\s+)?(?:final\s+)?(?:sealed\s+)?(?:base\s+)?(?:mixin\s+)?class\s+(\w+)/gm;
const DART_MIXIN_RE = /^mixin\s+(\w+)/gm;
const DART_ENUM_RE = /^enum\s+(\w+)/gm;
const DART_TYPEDEF_RE = /^typedef\s+(\w+)/gm;
const DART_TOP_LEVEL_CONST_RE = /^(?:const|final)\s+\w+\s+(\w+)\s*=/gm;
const DART_TOP_LEVEL_FUNC_RE = /^(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/gm;
const DART_EXTENSION_RE = /^extension\s+(\w+)/gm;

/**
 * Extract public symbol names from Dart source content.
 * Excludes private symbols (starting with _).
 */
export function extractDartExports(dartContent: string): readonly string[] {
  const exports = new Set<string>();

  const patterns = [
    DART_CLASS_RE,
    DART_MIXIN_RE,
    DART_ENUM_RE,
    DART_TYPEDEF_RE,
    DART_TOP_LEVEL_CONST_RE,
    DART_TOP_LEVEL_FUNC_RE,
    DART_EXTENSION_RE,
  ];

  for (const pattern of patterns) {
    // Reset lastIndex since we reuse regexes
    pattern.lastIndex = 0;
    for (const match of dartContent.matchAll(pattern)) {
      const name = match[1];
      if (name && !name.startsWith("_")) {
        exports.add(name);
      }
    }
  }

  return [...exports].sort();
}

// ── Diff computation ─────────────────────────────────────────────────

/**
 * Compute the diff between current and latest export sets.
 * "Changed" is detected when a name exists in both but would require
 * signature-level analysis — we report all common names as potentially changed
 * only if the file content differs.
 */
export function diffExports(
  current: readonly string[],
  latest: readonly string[],
): TypeDiff {
  const currentSet = new Set(current);
  const latestSet = new Set(latest);

  const added: string[] = [];
  const removed: string[] = [];

  for (const name of latestSet) {
    if (!currentSet.has(name)) {
      added.push(name);
    }
  }

  for (const name of currentSet) {
    if (!latestSet.has(name)) {
      removed.push(name);
    }
  }

  // Without full signature parsing, we can't reliably detect "changed" exports.
  // We report only added/removed. Signature changes within an existing export
  // are caught by Level 3's typecheck.
  return { added, removed, changed: [] };
}

// ── Import scanning ──────────────────────────────────────────────────

/**
 * Regex to match TypeScript imports from a specific package.
 * Captures named imports: import { Foo, Bar } from "pkg"
 */
function buildTsImportRegex(depName: string): RegExp {
  const escaped = depName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `import\\s*\\{([^}]+)\\}\\s*from\\s*["']${escaped}(?:\\/[^"']*)?["']`,
    "g",
  );
}

/**
 * Regex to match Dart imports from a specific package.
 * Captures: import 'package:pkg/...' show Foo, Bar;
 */
function buildDartImportRegex(depName: string): RegExp {
  const escaped = depName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `import\\s+['"]package:${escaped}\\/[^'"]*['"]\\s*(?:show\\s+([^;]+))?;`,
    "g",
  );
}

/**
 * Scan source files in a directory for named imports from a specific dependency.
 * Returns the set of imported symbol names.
 */
export async function findUsedSymbols(
  sourceDir: string,
  depName: string,
  ecosystem: string,
  sourceFiles: readonly string[],
): Promise<readonly string[]> {
  const symbols = new Set<string>();

  const importRegex =
    ecosystem === "dart" ? buildDartImportRegex(depName) : buildTsImportRegex(depName);

  for (const filePath of sourceFiles) {
    try {
      const content = await readFile(join(sourceDir, filePath), "utf-8");
      for (const match of content.matchAll(importRegex)) {
        const importList = match[1];
        if (importList) {
          for (const item of importList.split(",")) {
            const trimmed = item.trim();
            // Handle "Foo as Bar" — the local name is Bar but the imported symbol is Foo
            const parts = trimmed.split(/\s+as\s+/);
            const importedName = parts[0]?.trim();
            if (importedName && importedName.length > 0) {
              symbols.add(importedName);
            }
          }
        }
      }
    } catch {
      // File not readable — skip
    }
  }

  return [...symbols].sort();
}
