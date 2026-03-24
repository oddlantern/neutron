import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

/** Directories to always skip during scanning */
const SKIP_DIRS = new Set([
  'node_modules',
  '.dart_tool',
  'build',
  'dist',
  '.git',
  '.husky',
  '.idea',
  '.vscode',
]);

/** Manifest filenames and their ecosystem names */
const MANIFEST_MAP: ReadonlyMap<string, string> = new Map([
  ['package.json', 'typescript'],
  ['pubspec.yaml', 'dart'],
  ['Cargo.toml', 'rust'],
  ['pyproject.toml', 'python'],
]);

/** Ecosystems that mido currently supports */
const SUPPORTED_ECOSYSTEMS = new Set(['typescript', 'dart']);

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
  const gitignorePath = join(root, '.gitignore');
  const dirs = new Set<string>();

  if (!existsSync(gitignorePath)) {
    return dirs;
  }

  try {
    const content = readFileSync(gitignorePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      // Simple directory entries like "dist/" or "dist"
      const cleaned = trimmed.replace(/\/$/, '');
      if (cleaned && !cleaned.includes('*') && !cleaned.includes('/')) {
        dirs.add(cleaned);
      }
    }
  } catch {
    // Ignore read errors
  }

  return dirs;
}

/**
 * Check if a package.json at root level is a workspace root (not a real package).
 */
async function isWorkspaceRoot(manifestPath: string): Promise<boolean> {
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Has "workspaces" field — definitely a workspace root
    if (parsed['workspaces']) {
      return true;
    }

    // Private with no src/ — likely a workspace root
    if (parsed['private'] === true) {
      const dir = join(manifestPath, '..', 'src');
      if (!existsSync(dir)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
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

        const relPath = relative(root, fullPath);

        // Skip workspace root package.json
        if (manifest === 'package.json' && relPath === '.') {
          const isRoot = await isWorkspaceRoot(manifestPath);
          if (isRoot) {
            continue;
          }
        }

        packages.push({
          path: relPath,
          ecosystem,
          manifest,
          supported: SUPPORTED_ECOSYSTEMS.has(ecosystem),
        });
      }

      // Recurse into subdirectory
      await walk(fullPath);
    }
  }

  // Also check root for package.json (only if it's a real package, not workspace root)
  for (const [manifest, ecosystem] of MANIFEST_MAP) {
    const manifestPath = join(root, manifest);
    if (!existsSync(manifestPath)) {
      continue;
    }

    if (manifest === 'package.json') {
      const isRoot = await isWorkspaceRoot(manifestPath);
      if (isRoot) {
        continue;
      }
    }

    packages.push({
      path: '.',
      ecosystem,
      manifest,
      supported: SUPPORTED_ECOSYSTEMS.has(ecosystem),
    });
  }

  await walk(root);

  return packages;
}
