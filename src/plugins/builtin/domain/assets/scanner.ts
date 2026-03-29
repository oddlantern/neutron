import { readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import type { AssetCategory, AssetEntry, AssetManifest, ThemeVariant } from "@/plugins/builtin/domain/assets/types";

/** File extensions recognized as assets */
const ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  "svg",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
]);

/** Directory names that indicate theme variants */
const THEME_VARIANT_DIRS: ReadonlySet<string> = new Set(["light", "dark"]);

/**
 * Infer category and key from a filename.
 *
 * Convention: `{category}_{key}.ext` — e.g., `achievement_first_walk.svg`.
 * If no underscore prefix matches, the entire basename is the key and
 * the parent directory name is used as the category.
 */
function inferCategoryAndKey(
  name: string,
  parentDir: string,
): { readonly category: string; readonly key: string } {
  const underscoreIdx = name.indexOf("_");
  if (underscoreIdx > 0) {
    return {
      category: name.slice(0, underscoreIdx),
      key: name.slice(underscoreIdx + 1),
    };
  }
  // No prefix — use parent directory as category, full name as key
  return { category: parentDir || "misc", key: name };
}

/**
 * Recursively scan a directory for asset files.
 */
function scanDir(absDir: string, assetsRoot: string, parentDir: string): AssetEntry[] {
  const entries: AssetEntry[] = [];

  let dirEntries: readonly string[];
  try {
    dirEntries = readdirSync(absDir);
  } catch {
    return entries;
  }

  for (const entry of dirEntries) {
    const absPath = join(absDir, entry);
    const stat = statSync(absPath, { throwIfNoEntry: false });
    if (!stat) {
      continue;
    }

    if (stat.isDirectory()) {
      entries.push(...scanDir(absPath, assetsRoot, entry));
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    const ext = extname(entry).slice(1).toLowerCase();
    if (!ASSET_EXTENSIONS.has(ext)) {
      continue;
    }

    const nameWithoutExt = entry.slice(0, -(ext.length + 1));
    const relativePath = relative(assetsRoot, absPath);
    const { category, key } = inferCategoryAndKey(nameWithoutExt, parentDir);

    entries.push({ name: nameWithoutExt, ext, relativePath, category, key });
  }

  return entries;
}

/**
 * Detect theme variants in directories that contain light/dark subdirectories.
 */
function detectThemeVariants(
  allEntries: readonly AssetEntry[],
): readonly ThemeVariant[] {
  // Group entries whose path contains a theme variant directory
  const variantMap = new Map<string, Map<string, AssetEntry[]>>();

  for (const entry of allEntries) {
    const parts = entry.relativePath.split("/");
    const variantName = parts.find((p) => THEME_VARIANT_DIRS.has(p));
    if (!variantName) {
      continue;
    }

    const variantIdx = parts.indexOf(variantName);
    // Use the path segment before the variant as the group key
    const groupKey = parts.slice(0, variantIdx).join("/") || entry.category;

    let group = variantMap.get(groupKey);
    if (!group) {
      group = new Map();
      variantMap.set(groupKey, group);
    }

    let variantEntries = group.get(variantName);
    if (!variantEntries) {
      variantEntries = [];
      group.set(variantName, variantEntries);
    }
    variantEntries.push(entry);
  }

  const variants: ThemeVariant[] = [];
  for (const [category, group] of variantMap) {
    variants.push({ category, variants: group });
  }
  return variants;
}

/**
 * Collect unique top-level asset directories for pubspec declarations.
 */
function collectAssetDirectories(
  allEntries: readonly AssetEntry[],
): readonly string[] {
  const dirs = new Set<string>();
  for (const entry of allEntries) {
    const parts = entry.relativePath.split("/");
    if (parts.length > 1) {
      // Collect the full directory path (for nested dirs like icons/map_pins/light/)
      const dir = parts.slice(0, -1).join("/") + "/";
      dirs.add(dir);
    }
  }
  return [...dirs].sort();
}

/**
 * Group entries by category.
 */
function groupByCategory(entries: readonly AssetEntry[]): readonly AssetCategory[] {
  const map = new Map<string, AssetEntry[]>();
  for (const entry of entries) {
    let group = map.get(entry.category);
    if (!group) {
      group = [];
      map.set(entry.category, group);
    }
    group.push(entry);
  }

  const categories: AssetCategory[] = [];
  for (const [name, catEntries] of map) {
    categories.push({ name, entries: catEntries });
  }
  return categories.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Scan an assets package directory and produce a manifest.
 *
 * Looks for asset files in subdirectories (svg/, images/, map/, etc.).
 * Infers categories from filename prefixes.
 * Detects theme variants from light/dark subdirectories.
 */
export function scanAssets(assetsRoot: string, workspaceName: string): AssetManifest {
  const allEntries = scanDir(assetsRoot, assetsRoot, "");
  const categories = groupByCategory(allEntries);
  const themeVariants = detectThemeVariants(allEntries);
  const assetDirectories = collectAssetDirectories(allEntries);

  return {
    workspaceName,
    categories,
    themeVariants,
    allEntries,
    assetDirectories,
  };
}
