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

import { YELLOW, BOLD, RESET, DIM } from "../output.js";
import { VERSION } from "../version.js";
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

// ─── Semver comparison ───────────────────────────────────────────────────────

/** Parse "major.minor.patch" into a numeric tuple. Returns [0,0,0] on failure. */
function parseSemver(version: string): readonly [number, number, number] {
  const [maj, min, pat] = version.split(".").map(Number);
  if (maj === undefined || min === undefined || pat === undefined) return [0, 0, 0];
  if (Number.isNaN(maj) || Number.isNaN(min) || Number.isNaN(pat)) return [0, 0, 0];
  return [maj, min, pat];
}

/** True when `a >= b` using semver precedence. */
function semverGte(a: string, b: string): boolean {
  const [aMaj, aMin, aPat] = parseSemver(a);
  const [bMaj, bMin, bPat] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat >= bPat;
}

// ─── Migration pipeline ──────────────────────────────────────────────────────
//
// Each migration is a function that takes a YAML Document and returns true if
// it made changes. Migrations run in order and are idempotent — running an
// already-migrated config through them again is a no-op.
//
// Deprecation lifecycle:
//  - `deprecatedAt` — version where the old format was deprecated. Auto-migrates
//    with a warning telling users the old format will be removed.
//  - `removedAt` — version where auto-migration stops. If the old format is
//    still detected, the loader errors out and tells users to migrate manually
//    (or update from an intermediate mido version that still auto-migrates).
//
// Policy: `removedAt` is always the next minor version after `deprecatedAt`.
// Everything must be cleaned up before 1.0.0 — no deprecated formats ship at v1.
//
// To add a new migration:
//  1. Write a function: (doc: Document) => boolean
//  2. Append it to MIGRATIONS with a label, deprecatedAt, and removedAt (next minor)

interface Migration {
  readonly label: string;
  readonly run: (doc: Document) => boolean;
  /** Version where the old format was deprecated. */
  readonly deprecatedAt: string;
  /** Version where auto-migration is removed (always next minor after deprecatedAt). */
  readonly removedAt: string;
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

/** v0.4.0 → v0.5.0: Bridge target → consumers array */
function migrateBridgeTarget(doc: Document): boolean {
  let changed = false;
  const bridges = doc.get("bridges", true);
  if (!isSeq(bridges)) {
    return false;
  }

  for (const item of bridges.items) {
    if (!isMap(item)) {
      continue;
    }
    // If bridge has "target" but no "consumers", migrate
    if (item.has("target") && !item.has("consumers")) {
      const target = item.get("target");
      if (isScalar(target) && typeof target.value === "string") {
        item.set("consumers", [target.value]);
        item.delete("target");
        changed = true;
      }
    }
  }
  return changed;
}

/** All migrations in order. Each is idempotent. */
const MIGRATIONS: readonly Migration[] = [
  {
    label: "bridge fields from/to/via → source/target/artifact",
    run: migrateBridgeFields,
    deprecatedAt: "0.0.3",
    removedAt: "999.0.0",
  },
  {
    label: "flat lint/format → ecosystem-centric",
    run: migrateFlatLintFormat,
    deprecatedAt: "0.0.32",
    removedAt: "999.0.0",
  },
  {
    label: "bridge target → consumers array",
    run: migrateBridgeTarget,
    deprecatedAt: "0.4.0",
    removedAt: "999.0.0",
  },
];

interface MigrationResult {
  readonly applied: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Run all migrations on a parsed YAML document.
 *
 * Lifecycle:
 *  - If `removedAt` is set and current version >= removedAt, the migration is
 *    no longer available. If the old format is detected, throw with instructions
 *    to migrate manually.
 *  - Otherwise, auto-migrate and emit a deprecation warning with the removal version.
 */
function runMigrations(doc: Document): MigrationResult {
  const applied: string[] = [];
  const warnings: string[] = [];

  for (const migration of MIGRATIONS) {
    if (semverGte(VERSION, migration.removedAt)) {
      // Probe whether the old format is still present — run without mutating
      const probe = doc.clone();
      if (migration.run(probe)) {
        throw new Error(
          `mido.yml uses a config format that was removed in v${migration.removedAt}: ${migration.label}\n\n` +
            `Auto-migration is no longer available. Please update your mido.yml manually.\n` +
            `If you're upgrading from a much older version, first install mido@${previousMinor(migration.removedAt)} ` +
            `which still auto-migrates, then upgrade to the latest.`,
        );
      }
      continue;
    }

    if (migration.run(doc)) {
      applied.push(migration.label);
      warnings.push(
        `${YELLOW}⚠${RESET} ${BOLD}Deprecated config format:${RESET} ${migration.label}. Auto-migration will be removed in v${migration.removedAt}.\n` +
          `  ${DIM}Your mido.yml has been auto-migrated. Please review the changes.${RESET}`,
      );
    }
  }

  return { applied, warnings };
}

/** Given "1.0.0", return "0.x" as a hint for the intermediate version to install. */
function previousMinor(version: string): string {
  const [major, minor] = parseSemver(version);
  if (minor > 0) return `${major}.${minor - 1}`;
  if (major > 0) return `${major - 1}`;
  return "latest";
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
  const { applied, warnings } = runMigrations(doc);

  for (const warning of warnings) {
    console.error(warning);
  }

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
