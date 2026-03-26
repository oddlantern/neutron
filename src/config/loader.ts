import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  type Document,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parse as parseYaml,
  parseDocument,
} from "yaml";

import { configSchema, type MidoConfig } from "./schema.js";

const CONFIG_FILENAMES = ["mido.yml", "mido.yaml"] as const;

/**
 * Walk upward from `startDir` until we find a mido.yml/mido.yaml.
 * Returns the absolute path to the config file, or null if not found.
 */
function findConfigFile(startDir: string): string | null {
  let current = startDir;

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

// ─── Migration pipeline ──────────────────────────────────────────────────────
//
// Each migration is a function that takes a YAML Document and returns true if
// it made changes. Migrations run in order and are idempotent — running an
// already-migrated config through them again is a no-op.
//
// To add a new migration:
//  1. Write a function: (doc: Document) => boolean
//  2. Append it to MIGRATIONS with a label
//  3. The loader runs all migrations on every load — no version tracking needed

interface Migration {
  readonly label: string;
  readonly run: (doc: Document) => boolean;
}

/** v0.0.2 → v0.0.3: Bridge fields from/to/via → source/target/artifact */
const BRIDGE_FIELD_RENAMES: ReadonlyMap<string, string> = new Map([
  ["from", "source"],
  ["to", "target"],
  ["via", "artifact"],
]);

function migrateBridgeFields(doc: Document): boolean {
  let changed = false;
  const bridges = doc.get("bridges", true);
  if (!isSeq(bridges)) {
    return false;
  }

  for (const item of bridges.items) {
    if (!isMap(item)) {
      continue;
    }
    for (const [oldKey, newKey] of BRIDGE_FIELD_RENAMES) {
      if (item.has(oldKey)) {
        const value = item.get(oldKey);
        item.delete(oldKey);
        item.set(newKey, value);
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * v0.0.31 → v0.0.32: Flat lint/format → ecosystem-centric
 *
 * Old format:
 *   lint:
 *     rules: { eqeqeq: "warn" }
 *     ignore: ["dist"]
 *   format:
 *     singleQuote: true
 *     ignore: ["dist"]
 *
 * New format:
 *   lint:
 *     ignore: ["dist"]
 *     typescript:
 *       rules: { eqeqeq: "warn" }
 *   format:
 *     ignore: ["dist"]
 *     typescript:
 *       singleQuote: true
 */
function migrateFlatLintFormat(doc: Document): boolean {
  let changed = false;

  // ─── Lint migration ────────────────────────────────────────────────────
  const lint = doc.get("lint", true);
  if (isMap(lint)) {
    // Detect old format: has "rules" at top level (not nested under "typescript")
    const hasTopLevelRules = lint.has("rules") && !lint.has("typescript");
    if (hasTopLevelRules) {
      const rules = lint.get("rules");

      // Move rules into typescript.rules
      lint.delete("rules");
      const tsNode = doc.createNode({ rules });
      lint.set("typescript", tsNode);
      changed = true;
    }
  }

  // ─── Format migration ─────────────────────────────────────────────────
  const format = doc.get("format", true);
  if (isMap(format)) {
    // Detect old format: has formatting keys (not "ignore", "typescript", "dart") at top level
    const ECOSYSTEM_KEYS = new Set(["ignore", "typescript", "dart"]);
    const formatKeys: string[] = [];

    for (const pair of format.items) {
      if (!isPair(pair) || !isScalar(pair.key)) {
        continue;
      }
      const key = String(pair.key.value);
      if (!ECOSYSTEM_KEYS.has(key)) {
        formatKeys.push(key);
      }
    }

    if (formatKeys.length > 0 && !format.has("typescript")) {
      // Collect all non-ecosystem keys into a typescript sub-object
      const tsObj: Record<string, unknown> = {};
      for (const key of formatKeys) {
        tsObj[key] = format.get(key);
        format.delete(key);
      }

      const tsNode = doc.createNode(tsObj);
      format.set("typescript", tsNode);
      changed = true;
    }
  }

  // ─── Commits migration ────────────────────────────────────────────────
  // Old: commits was sometimes nested under lint
  // New: commits is always top-level
  if (isMap(lint) && lint.has("commits") && !doc.has("commits")) {
    const commits = lint.get("commits", true);
    lint.delete("commits");
    doc.set("commits", commits);
    changed = true;
  }

  return changed;
}

/** All migrations in order. Each is idempotent. */
const MIGRATIONS: readonly Migration[] = [
  { label: "bridge fields from/to/via → source/target/artifact", run: migrateBridgeFields },
  { label: "flat lint/format → ecosystem-centric", run: migrateFlatLintFormat },
];

/**
 * Run all migrations on a parsed YAML document.
 * Returns the list of migrations that were applied.
 */
function runMigrations(doc: Document): readonly string[] {
  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    if (migration.run(doc)) {
      applied.push(migration.label);
    }
  }
  return applied;
}

/**
 * Detect and migrate old config formats in place.
 * Uses parseDocument to preserve YAML formatting and comments.
 *
 * @returns migration result with applied labels and final content
 */
async function migrateConfig(
  configPath: string,
  raw: string,
): Promise<{ readonly applied: readonly string[]; readonly content: string }> {
  const doc = parseDocument(raw);
  const applied = runMigrations(doc);

  if (applied.length > 0) {
    const newContent = doc.toString();
    await writeFile(configPath, newContent, "utf-8");
    for (const label of applied) {
      console.log(`migrated mido.yml: ${label}`);
    }
    return { applied, content: newContent };
  }

  return { applied: [], content: raw };
}

// ─── Public API ──────────────────────────────────────────────────────────────

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
