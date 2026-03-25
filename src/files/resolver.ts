import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Directories always excluded from file resolution */
const ALWAYS_EXCLUDED: readonly string[] = ["node_modules", ".dart_tool", "build", "dist", ".git"];

/**
 * Normalize an ignore pattern for matching:
 *  - Strip leading "./"
 *  - A bare name with no glob chars and no extension is treated as a directory prefix
 */
function normalizePattern(pattern: string): string {
  if (pattern.startsWith("./")) {
    return pattern.slice(2);
  }
  return pattern;
}

/**
 * Check whether a relative path should be ignored by a set of patterns.
 *
 * Supports:
 *  - Directory prefixes: "generated" matches "generated/foo.ts"
 *  - Glob-star suffix:   "generated/**" matches "generated/foo.ts"
 *  - File globs:         "*.g.dart" matches "lib/foo.g.dart"
 *  - Exact paths:        "src/generated/api.d.ts"
 */
function isIgnored(filePath: string, patterns: readonly string[]): boolean {
  for (const raw of patterns) {
    const pattern = normalizePattern(raw);

    // "dir/**" — directory glob
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      if (filePath === prefix || filePath.startsWith(prefix + "/")) {
        return true;
      }
      continue;
    }

    // Exact match
    if (filePath === pattern) {
      return true;
    }

    // "*.ext" — extension glob (matches any path ending with .ext)
    if (pattern.startsWith("*.")) {
      const ext = pattern.slice(1); // e.g. ".g.dart"
      if (filePath.endsWith(ext)) {
        return true;
      }
      continue;
    }

    // Bare name with no glob, no extension, no slash → treat as directory prefix
    if (!pattern.includes("*") && !pattern.includes("/") && !pattern.includes(".")) {
      if (filePath === pattern || filePath.startsWith(pattern + "/")) {
        return true;
      }
      continue;
    }

    // Path prefix (e.g. "src/generated")
    if (!pattern.includes("*")) {
      if (filePath.startsWith(pattern + "/") || filePath === pattern) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Resolve files in a package directory for lint/format operations.
 *
 * Walks the package directory recursively, filters to files matching
 * the given extensions, and excludes files matching ignore patterns.
 *
 * @param packageDir — absolute path to the package directory
 * @param extensions — file extensions to include (e.g. ['.ts', '.tsx'])
 * @param ignorePatterns — patterns from mido.yml lint.ignore / format.ignore
 * @returns relative paths from the package root
 */
export function resolveFiles(
  packageDir: string,
  extensions: readonly string[],
  ignorePatterns: readonly string[],
): readonly string[] {
  const results: string[] = [];
  walkDir(packageDir, packageDir, extensions, ignorePatterns, results);
  return results;
}

function walkDir(
  dir: string,
  packageDir: string,
  extensions: readonly string[],
  ignorePatterns: readonly string[],
  results: string[],
): void {
  let entries: readonly string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    // Skip always-excluded directories at any depth
    if (ALWAYS_EXCLUDED.includes(entry)) {
      continue;
    }

    const fullPath = join(dir, entry);
    const rel = relative(packageDir, fullPath);

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      // Check if this directory is ignored before recursing
      if (isIgnored(rel, ignorePatterns)) {
        continue;
      }
      walkDir(fullPath, packageDir, extensions, ignorePatterns, results);
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    // Check extension match
    if (!extensions.some((ext) => entry.endsWith(ext))) {
      continue;
    }

    // Check ignore patterns on the file itself
    if (isIgnored(rel, ignorePatterns)) {
      continue;
    }

    results.push(rel);
  }
}
