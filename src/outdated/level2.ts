import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";

import { isRecord } from "@/guards";
import type { WorkspacePackage } from "@/graph/types";

import {
  extractTypescriptExports,
  extractDartExports,
  diffExports,
  findUsedSymbols,
} from "@/outdated/api-diff";
import { downloadTarball, extractFromTarGz } from "@/outdated/tarball";
import type { OutdatedDep, StaticAnalysisResult } from "@/outdated/types";

// ── TypeScript analysis ──────────────────────────────────────────────

/**
 * Find the main .d.ts file for an installed npm package.
 * Checks package.json `types`/`typings` field, then falls back to `index.d.ts`.
 */
async function findInstalledDts(
  root: string,
  depName: string,
): Promise<readonly string[] | null> {
  const pkgDir = join(root, "node_modules", depName);

  try {
    const manifestPath = join(pkgDir, "package.json");
    const raw = await readFile(manifestPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed)) {
      return null;
    }

    const typesField = parsed["types"] ?? parsed["typings"];
    const mainDts = typeof typesField === "string" ? typesField : "index.d.ts";

    const dtsPath = join(pkgDir, mainDts);
    const content = await readFile(dtsPath, "utf-8");
    return [content];
  } catch {
    // Try collecting all .d.ts files in the package root
    try {
      const files = await readdir(pkgDir);
      const dtsFiles = files.filter((f) => f.endsWith(".d.ts"));
      if (dtsFiles.length === 0) {
        return null;
      }
      const contents = await Promise.all(
        dtsFiles.map((f) => readFile(join(pkgDir, f), "utf-8")),
      );
      return contents;
    } catch {
      return null;
    }
  }
}

/**
 * Analyze a TypeScript dependency: diff exports between installed and latest.
 */
async function analyzeTypescriptDep(
  dep: OutdatedDep,
  root: string,
  sourceFiles: readonly string[],
): Promise<StaticAnalysisResult> {
  // Get current exports from installed package
  const installedDts = await findInstalledDts(root, dep.name);
  if (!installedDts) {
    return { dep, typeDiff: undefined, usedRemovedExports: [], usedChangedExports: [] };
  }

  const currentExports = installedDts.flatMap((content) => [...extractTypescriptExports(content)]);

  // Get latest exports from tarball
  if (!dep.metadata.tarballUrl) {
    return { dep, typeDiff: undefined, usedRemovedExports: [], usedChangedExports: [] };
  }

  const tarball = await downloadTarball(dep.metadata.tarballUrl);
  if (!tarball) {
    return { dep, typeDiff: undefined, usedRemovedExports: [], usedChangedExports: [] };
  }

  const latestFiles = extractFromTarGz(tarball, (path) => path.endsWith(".d.ts"));
  const latestExports = [...latestFiles.values()].flatMap((content) => [
    ...extractTypescriptExports(content),
  ]);

  const typeDiff = diffExports(currentExports, latestExports);

  // Cross-reference with codebase usage
  const usedSymbols = await findUsedSymbols(root, dep.name, "typescript", sourceFiles);
  const usedRemovedExports = typeDiff.removed.filter((name) => usedSymbols.includes(name));
  const usedChangedExports = typeDiff.changed.filter((name) => usedSymbols.includes(name));

  return { dep, typeDiff, usedRemovedExports, usedChangedExports };
}

// ── Dart analysis ────────────────────────────────────────────────────

/**
 * Find installed Dart package source files from the pub cache.
 * Uses .dart_tool/package_config.json to resolve the package path.
 */
async function findInstalledDartSources(
  root: string,
  depName: string,
): Promise<readonly string[] | null> {
  try {
    const configPath = join(root, ".dart_tool", "package_config.json");
    const raw = await readFile(configPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed)) {
      return null;
    }

    const packages = parsed["packages"];
    if (!Array.isArray(packages)) {
      return null;
    }

    for (const pkg of packages) {
      if (!isRecord(pkg)) {
        continue;
      }
      if (pkg["name"] === depName && typeof pkg["rootUri"] === "string") {
        const rootUri = pkg["rootUri"];
        const packageUri = typeof pkg["packageUri"] === "string" ? pkg["packageUri"] : "lib/";

        // rootUri can be relative (to .dart_tool/) or absolute
        let libDir: string;
        if (rootUri.startsWith("file://")) {
          libDir = join(new URL(rootUri).pathname, packageUri);
        } else {
          libDir = join(root, ".dart_tool", rootUri, packageUri);
        }

        const files = await collectDartFiles(libDir);
        if (files.length === 0) {
          return null;
        }

        return await Promise.all(files.map((f) => readFile(f, "utf-8")));
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Recursively collect .dart files from a directory.
 */
async function collectDartFiles(dir: string): Promise<readonly string[]> {
  const result: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await collectDartFiles(fullPath);
        result.push(...nested);
      } else if (entry.isFile() && entry.name.endsWith(".dart")) {
        result.push(fullPath);
      }
    }
  } catch {
    // Directory not readable
  }

  return result;
}

/**
 * Analyze a Dart dependency: diff public API between installed and latest.
 */
async function analyzeDartDep(
  dep: OutdatedDep,
  root: string,
  sourceFiles: readonly string[],
): Promise<StaticAnalysisResult> {
  const installedSources = await findInstalledDartSources(root, dep.name);
  if (!installedSources) {
    return { dep, typeDiff: undefined, usedRemovedExports: [], usedChangedExports: [] };
  }

  const currentExports = installedSources.flatMap((content) => [...extractDartExports(content)]);

  // Download latest from pub.dev archive
  if (!dep.metadata.tarballUrl) {
    return { dep, typeDiff: undefined, usedRemovedExports: [], usedChangedExports: [] };
  }

  const tarball = await downloadTarball(dep.metadata.tarballUrl);
  if (!tarball) {
    return { dep, typeDiff: undefined, usedRemovedExports: [], usedChangedExports: [] };
  }

  const latestFiles = extractFromTarGz(tarball, (path) =>
    path.startsWith("lib/") && path.endsWith(".dart"),
  );
  const latestExports = [...latestFiles.values()].flatMap((content) => [
    ...extractDartExports(content),
  ]);

  const typeDiff = diffExports(currentExports, latestExports);

  const usedSymbols = await findUsedSymbols(root, dep.name, "dart", sourceFiles);
  const usedRemovedExports = typeDiff.removed.filter((name) => usedSymbols.includes(name));
  const usedChangedExports = typeDiff.changed.filter((name) => usedSymbols.includes(name));

  return { dep, typeDiff, usedRemovedExports, usedChangedExports };
}

// ── Source file collection ───────────────────────────────────────────

/**
 * Collect source file paths relative to the workspace root for a given ecosystem.
 */
async function collectSourceFiles(
  root: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
  ecosystem: string,
): Promise<readonly string[]> {
  const result: string[] = [];

  for (const [, pkg] of packages) {
    if (pkg.ecosystem !== ecosystem) {
      continue;
    }

    const pkgDir = join(root, pkg.path);
    const ext = ecosystem === "dart" ? ".dart" : ".ts";

    try {
      const srcDir = join(pkgDir, ecosystem === "dart" ? "lib" : "src");
      const files = await collectFilesWithExt(srcDir, ext);
      for (const file of files) {
        // Store relative to root for readFile calls
        result.push(file.slice(root.length + 1));
      }
    } catch {
      // Package source dir doesn't exist — skip
    }
  }

  return result;
}

/**
 * Recursively collect files with a given extension.
 */
async function collectFilesWithExt(dir: string, ext: string): Promise<readonly string[]> {
  const result: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "generated") {
        const nested = await collectFilesWithExt(fullPath, ext);
        result.push(...nested);
      } else if (entry.isFile() && extname(entry.name) === ext) {
        result.push(fullPath);
      }
    }
  } catch {
    // Not readable
  }

  return result;
}

// ── Level 2 orchestrator ─────────────────────────────────────────────

const CONCURRENCY = 5;

/**
 * Run Level 2 static analysis on outdated dependencies.
 * Downloads latest tarballs, extracts type declarations / public API,
 * diffs against installed versions, and cross-references with codebase usage.
 */
export async function runLevel2(
  outdated: readonly OutdatedDep[],
  root: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
): Promise<readonly StaticAnalysisResult[]> {
  // Pre-collect source files per ecosystem
  const tsSourceFiles = await collectSourceFiles(root, packages, "typescript");
  const dartSourceFiles = await collectSourceFiles(root, packages, "dart");

  const results: StaticAnalysisResult[] = [];

  for (let i = 0; i < outdated.length; i += CONCURRENCY) {
    const batch = outdated.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((dep) => {
        if (dep.ecosystem === "dart") {
          return analyzeDartDep(dep, root, dartSourceFiles);
        }
        return analyzeTypescriptDep(dep, root, tsSourceFiles);
      }),
    );
    results.push(...batchResults);
  }

  return results;
}
