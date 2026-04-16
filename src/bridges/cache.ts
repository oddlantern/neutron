import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CACHE_DIR } from "@/branding";
import { isRecord } from "@/guards";

const CACHE_FILE = "pipeline-cache.json";

interface CacheEntry {
  readonly inputHash: string;
  readonly timestamp: number;
}

type CacheData = Record<string, CacheEntry>;

function getCachePath(root: string): string {
  return join(root, CACHE_DIR, CACHE_FILE);
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value["inputHash"] === "string" && typeof value["timestamp"] === "number";
}

function readCache(root: string): CacheData {
  const cachePath = getCachePath(root);
  if (!existsSync(cachePath)) {
    return {};
  }
  try {
    const raw = readFileSync(cachePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || !parsed) {
      return {};
    }
    // Validate each entry
    const result: CacheData = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isCacheEntry(value)) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    // Corrupt cache — start fresh
  }
  return {};
}

function writeCache(root: string, data: CacheData): void {
  const cacheDir = join(root, CACHE_DIR);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(getCachePath(root), JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Hash the contents of a single file.
 */
async function hashFile(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return "";
  }
}

/**
 * Compute a combined hash for a bridge's inputs:
 * - The artifact file itself
 * - All files matching the watch patterns
 */
export async function computeInputHash(
  root: string,
  artifact: string,
  watchPatterns: readonly string[],
): Promise<string> {
  const hash = createHash("sha256");

  // Hash the artifact
  const artifactHash = await hashFile(join(root, artifact));
  hash.update(`artifact:${artifact}:${artifactHash}`);

  // Hash watch pattern files (sorted for determinism)
  for (const pattern of watchPatterns) {
    const baseDir = pattern.replace(/\/?\*\*.*$/, "");
    const absDir = join(root, baseDir);

    if (!existsSync(absDir)) {
      continue;
    }

    // Read directory recursively and hash each file
    const files = collectFiles(absDir);
    for (const file of files.sort()) {
      const fileHash = await hashFile(file);
      if (fileHash) {
        const relPath = file.slice(root.length + 1);
        hash.update(`${relPath}:${fileHash}`);
      }
    }
  }

  return hash.digest("hex");
}

/**
 * Recursively collect all files in a directory (sync, for simplicity).
 */
function collectFiles(dir: string): string[] {
  const results: string[] = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      // Skip common non-source directories
      if (
        entry === "node_modules" ||
        entry === ".dart_tool" ||
        entry === "build" ||
        entry === "dist" ||
        entry === ".git"
      ) {
        continue;
      }
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          results.push(...collectFiles(fullPath));
        } else {
          results.push(fullPath);
        }
      } catch {
        // Skip inaccessible files
      }
    }
  } catch {
    // Skip inaccessible directories
  }

  return results;
}

/**
 * Check if a bridge's inputs have changed since the last successful run.
 * Returns true if the pipeline should be skipped (cache hit).
 */
export async function isCacheHit(
  root: string,
  bridgeKey: string,
  artifact: string,
  watchPatterns: readonly string[],
): Promise<boolean> {
  const cache = readCache(root);
  const entry = cache[bridgeKey];
  if (!entry) {
    return false;
  }

  const currentHash = await computeInputHash(root, artifact, watchPatterns);
  return entry.inputHash === currentHash;
}

/**
 * Update the cache after a successful pipeline run.
 */
export async function updateCache(
  root: string,
  bridgeKey: string,
  artifact: string,
  watchPatterns: readonly string[],
): Promise<void> {
  const cache = readCache(root);
  const inputHash = await computeInputHash(root, artifact, watchPatterns);
  cache[bridgeKey] = { inputHash, timestamp: Date.now() };
  writeCache(root, cache);
}

/**
 * Clear the entire pipeline cache.
 */
export function clearCache(root: string): void {
  writeCache(root, {});
}
