import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CACHE_DIR as CACHE_DIR_NAME } from "@/branding";
import type { FormatTypescriptConfig, LintTypescriptConfig } from "@/config/schema";
import type { WorkspacePackage } from "@/graph/types";
import { hasDep, isRecord } from "@/plugins/builtin/shared/exec";

/** Ensure the cache directory exists and return its absolute path */
function ensureCacheDir(root: string): string {
  const cacheDir = join(root, CACHE_DIR_NAME);
  mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

/** Cache for written config paths — avoids concurrent writes to the same file */
let cachedOxlintConfigPath: string | null | undefined;
let cachedOxfmtConfigPath: string | null | undefined;

/** Oxlint plugins always enabled */
const ALWAYS_ENABLED_PLUGINS: readonly string[] = ["typescript", "unicorn", "oxc", "import"];

/** Dependency-to-plugin mapping for auto-detection */
const DEP_PLUGIN_MAP: ReadonlyMap<string, readonly string[]> = new Map([
  ["react", ["react", "jsx-a11y", "react-perf"]],
  ["preact", ["react", "jsx-a11y", "react-perf"]],
  ["@preact/preset-vite", ["react", "jsx-a11y", "react-perf"]],
  ["jest", ["jest"]],
  ["vitest", ["vitest"]],
  ["next", ["nextjs"]],
]);

/**
 * Auto-detect oxlint plugins based on workspace dependencies.
 * Always enables: typescript, unicorn, oxc, import.
 * Conditionally enables: react, jsx-a11y, react-perf (if React/Preact), jest, vitest, nextjs.
 */
export function detectOxlintPlugins(pkg: WorkspacePackage, root: string): readonly string[] {
  const plugins = new Set<string>(ALWAYS_ENABLED_PLUGINS);

  try {
    // Read the package.json synchronously for simplicity — this runs at lint time, not hot path
    const manifestPath = join(root, pkg.path, "package.json");
    if (!existsSync(manifestPath)) {
      return [...plugins];
    }
    const raw = readFileSync(manifestPath, "utf-8");
    const manifest: unknown = JSON.parse(raw);
    if (!isRecord(manifest)) {
      return [...plugins];
    }

    for (const [dep, depPlugins] of DEP_PLUGIN_MAP) {
      if (hasDep(manifest, dep)) {
        for (const p of depPlugins) {
          plugins.add(p);
        }
      }
    }
  } catch {
    // Can't read manifest — use defaults
  }

  return [...plugins];
}

/** Category names in oxlint */
type OxlintCategory =
  | "correctness"
  | "suspicious"
  | "pedantic"
  | "perf"
  | "style"
  | "restriction"
  | "nursery";
const ALL_CATEGORIES: readonly OxlintCategory[] = [
  "correctness",
  "suspicious",
  "pedantic",
  "perf",
  "style",
  "restriction",
  "nursery",
];

/**
 * Generate a temporary oxlintrc.json from the neutron lint.typescript config.
 * Includes categories, rules, and auto-detected plugins.
 * Returns the path to the file, or null if no config is needed.
 */
export function writeOxlintConfig(
  root: string,
  lint: LintTypescriptConfig,
  plugins: readonly string[],
): string | null {
  const config: Record<string, unknown> = {};

  // Categories
  if (lint.categories) {
    const categories: Record<string, string> = {};
    for (const cat of ALL_CATEGORIES) {
      const level = lint.categories[cat];
      if (level !== undefined) {
        categories[cat] = level;
      }
    }
    if (Object.keys(categories).length > 0) {
      config["categories"] = categories;
    }
  }

  // Rules
  if (lint.rules && Object.keys(lint.rules).length > 0) {
    config["rules"] = lint.rules;
  }

  // Plugins — always include so oxlint enables the right set
  if (plugins.length > 0) {
    config["plugins"] = plugins;
  }

  if (cachedOxlintConfigPath !== undefined) {
    return cachedOxlintConfigPath;
  }

  const cacheDir = ensureCacheDir(root);
  const configPath = join(cacheDir, "oxlintrc.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  cachedOxlintConfigPath = configPath;
  return configPath;
}

/**
 * Generate a temporary oxfmtrc.json from the neutron format.typescript config.
 * Returns the config path, or null if no config is needed.
 */
export function writeOxfmtConfig(root: string, format: FormatTypescriptConfig): string | null {
  if (cachedOxfmtConfigPath !== undefined) {
    return cachedOxfmtConfigPath;
  }

  const opts: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(format)) {
    if (value !== undefined) {
      opts[key] = value;
    }
  }

  if (Object.keys(opts).length === 0) {
    cachedOxfmtConfigPath = null;
    return null;
  }

  const cacheDir = ensureCacheDir(root);
  const configPath = join(cacheDir, "oxfmtrc.json");
  writeFileSync(configPath, JSON.stringify(opts, null, 2) + "\n", "utf-8");
  cachedOxfmtConfigPath = configPath;
  return configPath;
}
