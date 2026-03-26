import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Directories to always skip during scanning */
const SKIP_DIRS = new Set([
  ".dart_tool",
  ".git",
  ".husky",
  ".idea",
  ".mido",
  ".symlinks",
  ".vscode",
  "android",
  "build",
  "dist",
  "example",
  "ios",
  "linux",
  "macos",
  "node_modules",
  "web",
  "windows",
]);

/** Manifest filenames and their ecosystem names */
const MANIFEST_MAP: ReadonlyMap<string, string> = new Map([
  ["package.json", "typescript"],
  ["pubspec.yaml", "dart"],
  ["Cargo.toml", "rust"],
  ["pyproject.toml", "python"],
]);

/** Ecosystems that mido currently supports */
const SUPPORTED_ECOSYSTEMS = new Set(["typescript", "dart"]);

export interface DiscoveredPackage {
  readonly path: string;
  readonly ecosystem: string;
  readonly manifest: string;
  readonly supported: boolean;
}

/**
 * Load .gitignore patterns from root. Returns a simple set of directory names
 * to skip (not full glob support — just top-level directory names).
 */
function loadGitignoreDirs(root: string): Set<string> {
  const gitignorePath = join(root, ".gitignore");
  const dirs = new Set<string>();

  if (!existsSync(gitignorePath)) {
    return dirs;
  }

  try {
    const content = readFileSync(gitignorePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      // Simple directory entries like "dist/" or "dist"
      const cleaned = trimmed.replace(/\/$/, "");
      if (cleaned && !cleaned.includes("*") && !cleaned.includes("/")) {
        dirs.add(cleaned);
      }
    }
  } catch {
    // Ignore read errors
  }

  return dirs;
}

/**
 * Scan a repository root for ecosystem markers.
 * Returns all discovered packages (both supported and unsupported).
 */
export async function scanRepo(root: string): Promise<readonly DiscoveredPackage[]> {
  const gitignoreDirs = loadGitignoreDirs(root);
  const skipAll = new Set([...SKIP_DIRS, ...gitignoreDirs]);
  const packages: DiscoveredPackage[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (skipAll.has(entry)) {
        continue;
      }

      const fullPath = join(dir, entry);

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (!stat.isDirectory()) {
        continue;
      }

      // Check for manifest files in this directory
      for (const [manifest, ecosystem] of MANIFEST_MAP) {
        const manifestPath = join(fullPath, manifest);
        if (!existsSync(manifestPath)) {
          continue;
        }

        packages.push({
          path: relative(root, fullPath),
          ecosystem,
          manifest,
          supported: SUPPORTED_ECOSYSTEMS.has(ecosystem),
        });
      }

      // Recurse into subdirectory
      await walk(fullPath);
    }
  }

  await walk(root);

  return packages;
}
