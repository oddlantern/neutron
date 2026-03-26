import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isMap, isSeq, parse as parseYaml, parseDocument } from "yaml";

import { configSchema, type MidoConfig } from "./schema.js";

const CONFIG_FILENAMES = ["mido.yml", "mido.yaml"] as const;

/**
 * Walk upward from `startDir` until we find a mido.yml/mido.yaml.
 * Returns the absolute path to the config file, or null if not found.
 */
function findConfigFile(startDir: string): string | null {
  let current = startDir;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = join(current, filename);
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    const parent = dirname(current);
    // Reached filesystem root
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/** Field renames for bridge schema migration (v0.0.2 → v0.0.3) */
const BRIDGE_FIELD_RENAMES: ReadonlyMap<string, string> = new Map([
  ["from", "source"],
  ["to", "target"],
  ["via", "artifact"],
]);

/**
 * Detect and migrate old config formats in place.
 * Uses parseDocument to preserve YAML formatting and comments.
 *
 * @returns true if migration was performed, false if no migration needed
 */
async function migrateConfig(
  configPath: string,
  raw: string,
): Promise<{ migrated: boolean; content: string }> {
  const doc = parseDocument(raw);
  let migrated = false;

  // Migrate bridges: from/to/via → source/target/artifact
  const bridges = doc.get("bridges", true);
  if (isSeq(bridges)) {
    for (const item of bridges.items) {
      if (!isMap(item)) {
        continue;
      }

      for (const [oldKey, newKey] of BRIDGE_FIELD_RENAMES) {
        if (item.has(oldKey)) {
          const value = item.get(oldKey);
          item.delete(oldKey);
          item.set(newKey, value);
          migrated = true;
        }
      }
    }
  }

  if (migrated) {
    const newContent = doc.toString();
    await writeFile(configPath, newContent, "utf-8");
    console.log("migrated mido.yml to v0.0.3 format.");
    return { migrated: true, content: newContent };
  }

  return { migrated: false, content: raw };
}

export interface LoadedConfig {
  readonly config: MidoConfig;
  /** Absolute path to the workspace root (directory containing mido.yml) */
  readonly root: string;
  /** Absolute path to the config file itself */
  readonly configPath: string;
}

/**
 * Locate and parse the mido config file.
 * Searches upward from the given directory (defaults to cwd).
 *
 * @throws {Error} if no config file is found or validation fails
 */
export async function loadConfig(startDir?: string): Promise<LoadedConfig> {
  const searchFrom = startDir ?? process.cwd();
  const configPath = findConfigFile(searchFrom);

  if (!configPath) {
    throw new Error(
      `No mido.yml found. Searched upward from ${searchFrom}\n` +
        'Create a mido.yml in your workspace root, or run "mido init" to generate one.',
    );
  }

  let raw = await readFile(configPath, "utf-8");

  // Migrate old config formats before validation
  const migration = await migrateConfig(configPath, raw);
  raw = migration.content;

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (cause) {
    throw new Error(`Invalid YAML in ${configPath}`, { cause });
  }

  const result = configSchema.safeParse(parsed);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");

    throw new Error(`Invalid mido config at ${configPath}:\n${issues}`);
  }

  const root = dirname(configPath);

  return { config: result.data, root, configPath };
}
