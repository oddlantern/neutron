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

// ── Python export extraction ────────────────────────────────────────

const PY_ALL_RE = /^__all__\s*=\s*\[([^\]]*)\]/ms;
const PY_CLASS_RE = /^class\s+(\w+)/gm;
const PY_DEF_RE = /^(?:async\s+)?def\s+(\w+)/gm;

/**
 * Extract public symbol names from Python source content.
 * Uses __all__ if defined, otherwise top-level class/def names.
 */
export function extractPythonExports(pyContent: string): readonly string[] {
  const allMatch = PY_ALL_RE.exec(pyContent);
  if (allMatch?.[1]) {
    return allMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/["']/g, ""))
      .filter((s) => s.length > 0)
      .sort();
  }

  const exports = new Set<string>();
  for (const match of pyContent.matchAll(PY_CLASS_RE)) {
    if (match[1] && !match[1].startsWith("_")) {
      exports.add(match[1]);
    }
  }
  for (const match of pyContent.matchAll(PY_DEF_RE)) {
    if (match[1] && !match[1].startsWith("_")) {
      exports.add(match[1]);
    }
  }
  return [...exports].sort();
}

// ── Rust export extraction ──────────────────────────────────────────

const RUST_PUB_RE = /^pub\s+(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?(?:fn|struct|enum|trait|type|mod|const|static)\s+(\w+)/gm;

/**
 * Extract public symbol names from Rust source content.
 */
export function extractRustExports(rsContent: string): readonly string[] {
  const exports = new Set<string>();
  RUST_PUB_RE.lastIndex = 0;
  for (const match of rsContent.matchAll(RUST_PUB_RE)) {
    if (match[1]) {
      exports.add(match[1]);
    }
  }
  return [...exports].sort();
}

// ── Go export extraction ────────────────────────────────────────────

const GO_FUNC_RE = /^func\s+(?:\([^)]+\)\s+)?(\w+)/gm;
const GO_TYPE_RE = /^type\s+(\w+)/gm;
const GO_CONST_RE = /^(?:const|var)\s+(\w+)/gm;

/**
 * Extract exported symbol names from Go source content.
 * Exported names start with an uppercase letter.
 */
export function extractGoExports(goContent: string): readonly string[] {
  const exports = new Set<string>();
  const patterns = [GO_FUNC_RE, GO_TYPE_RE, GO_CONST_RE];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of goContent.matchAll(pattern)) {
      if (match[1] && /^[A-Z]/.test(match[1])) {
        exports.add(match[1]);
      }
    }
  }
  return [...exports].sort();
}

// ── PHP export extraction ───────────────────────────────────────────

const PHP_CLASS_RE = /^(?:final\s+)?(?:abstract\s+)?class\s+(\w+)/gm;
const PHP_INTERFACE_RE = /^interface\s+(\w+)/gm;
const PHP_TRAIT_RE = /^trait\s+(\w+)/gm;
const PHP_FUNCTION_RE = /^function\s+(\w+)/gm;

/**
 * Extract public symbol names from PHP source content.
 */
export function extractPhpExports(phpContent: string): readonly string[] {
  const exports = new Set<string>();
  const patterns = [PHP_CLASS_RE, PHP_INTERFACE_RE, PHP_TRAIT_RE, PHP_FUNCTION_RE];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of phpContent.matchAll(pattern)) {
      if (match[1]) {
        exports.add(match[1]);
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

function buildPythonImportRegex(depName: string): RegExp {
  const escaped = depName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `from\\s+${escaped}(?:\\.\\w+)*\\s+import\\s+([^\\n]+)`,
    "g",
  );
}

function buildRustImportRegex(depName: string): RegExp {
  const escaped = depName.replace(/-/g, "_").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `use\\s+${escaped}(?:::\\{([^}]+)\\}|::(\\w+))`,
    "g",
  );
}

function buildGoImportRegex(depName: string): RegExp {
  const escaped = depName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alias = depName.split("/").pop() ?? depName;
  return new RegExp(`${alias}\\.([A-Z]\\w*)`, "g");
}

function buildPhpImportRegex(depName: string): RegExp {
  const escaped = depName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\//g, "\\\\\\\\");
  return new RegExp(`use\\s+${escaped}\\\\([^;]+)`, "g");
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

  let importRegex: RegExp;
  switch (ecosystem) {
    case "dart":
      importRegex = buildDartImportRegex(depName);
      break;
    case "python":
      importRegex = buildPythonImportRegex(depName);
      break;
    case "rust":
      importRegex = buildRustImportRegex(depName);
      break;
    case "go":
      importRegex = buildGoImportRegex(depName);
      break;
    case "php":
      importRegex = buildPhpImportRegex(depName);
      break;
    default:
      importRegex = buildTsImportRegex(depName);
  }

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
