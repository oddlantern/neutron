import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { confirm, isCancel, log } from "@clack/prompts";

import { isRecord } from "@/guards";

export interface MigratedToolConfig {
  readonly lint?: Record<string, unknown>;
  readonly format?: Record<string, unknown>;
}

// ─── JSON/JSONC parsing ──────────────────────────────────────────────────────

/** Strip single-line (//) and block comments from JSONC, preserving strings. */
function stripJsonComments(raw: string): string {
  return raw.replace(
    /("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (_match, quoted: string | undefined) => quoted ?? "",
  );
}

function parseJsonOrJsonc(raw: string): unknown {
  return JSON.parse(stripJsonComments(raw));
}

/** Read and parse a JSON/JSONC file if it exists. Returns null on missing or parse error. */
async function readJsonConfig(filePath: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = parseJsonOrJsonc(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Load a JS/TS config file via dynamic import().
 * Returns the default export if it's an object, null otherwise.
 */
async function loadJsConfig(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const mod: unknown = await import(pathToFileURL(filePath).href);
    if (!isRecord(mod)) {
      return null;
    }
    const config = mod["default"] ?? mod;
    return isRecord(config) ? config : null;
  } catch {
    return null;
  }
}

/** Read an ignore file (one pattern per line, skip comments and blanks). */
async function readIgnorePatterns(filePath: string): Promise<readonly string[]> {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const raw = await readFile(filePath, "utf-8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

/** Prompt to remove a file. Returns true if removed. */
async function promptRemoveFile(
  filePath: string,
  label: string,
  onCancel: () => never,
): Promise<boolean> {
  const answer = await confirm({
    message: `Remove ${label}? (config now lives in neutron.yml)`,
    initialValue: true,
  });
  if (isCancel(answer)) {
    onCancel();
  }
  if (answer) {
    await unlink(filePath);
    log.step(`Removed ${label}`);
    return true;
  }
  return false;
}

// ─── Config extraction ───────────────────────────────────────────────────────

const OXLINT_JSON_CONFIGS = [".oxlintrc.json"] as const;
const OXLINT_JS_CONFIGS = ["oxlint.config.ts", "oxlint.config.js"] as const;

/**
 * Extract the neutron lint section from an oxlint config object.
 * Produces ecosystem-centric structure: { ignore, typescript: { categories, rules } }
 */
function extractLintConfig(parsed: Record<string, unknown>): Record<string, unknown> {
  const lint: Record<string, unknown> = {};
  const ts: Record<string, unknown> = {};

  if (isRecord(parsed["categories"]) && Object.keys(parsed["categories"]).length > 0) {
    ts["categories"] = parsed["categories"];
  }
  if (isRecord(parsed["rules"]) && Object.keys(parsed["rules"]).length > 0) {
    ts["rules"] = parsed["rules"];
  }
  if (Object.keys(ts).length > 0) {
    lint["typescript"] = ts;
  }
  if (Array.isArray(parsed["ignorePatterns"]) && parsed["ignorePatterns"].length > 0) {
    lint["ignore"] = parsed["ignorePatterns"];
  }
  return lint;
}

const OXFMT_JSON_CONFIGS = [
  ".oxfmtrc.json",
  ".oxfmtrc.jsonc",
  ".prettierrc.json",
  ".prettierrc",
] as const;

const IGNORE_FILES = [".oxfmtignore", ".prettierignore"] as const;

const FORMAT_META_KEYS = new Set(["$schema"]);

/**
 * Extract all formatting options from an oxfmt/prettier config.
 * Produces ecosystem-centric structure: { typescript: { printWidth, semi, ... } }
 */
function extractFormatConfig(parsed: Record<string, unknown>): Record<string, unknown> {
  const ts: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!FORMAT_META_KEYS.has(key)) {
      ts[key] = value;
    }
  }
  if (Object.keys(ts).length === 0) {
    return {};
  }
  return { typescript: ts };
}

const STALE_ESLINT_CONFIGS = [
  ".eslintrc.json",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.yml",
  ".eslintrc.yaml",
  ".eslintrc",
] as const;

const STALE_PRETTIER_CONFIGS = [".prettierrc", ".prettierrc.json", ".prettierignore"] as const;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Migrate existing lint/format config files into neutron.yml sections.
 *
 * Detects:
 *  - oxlint: .oxlintrc.json, oxlint.config.ts, oxlint.config.js
 *  - oxfmt:  .oxfmtrc.json, .oxfmtrc.jsonc, .prettierrc.json, .prettierrc
 *  - ignore: .oxfmtignore, .prettierignore
 *
 * After migration, offers to remove stale eslint/prettier config files.
 */
export async function migrateLintFormatConfig(
  root: string,
  onCancel: () => never,
): Promise<MigratedToolConfig> {
  const migrated: { lint?: Record<string, unknown>; format?: Record<string, unknown> } = {};
  const removedFiles = new Set<string>();

  // ─── Oxlint ────────────────────────────────────────────────────────────

  for (const name of OXLINT_JSON_CONFIGS) {
    const filePath = join(root, name);
    const parsed = await readJsonConfig(filePath);
    if (!parsed) {
      continue;
    }

    const lint = extractLintConfig(parsed);
    if (Object.keys(lint).length > 0) {
      migrated.lint = lint;
      log.info(`Migrated ${name} into neutron.yml lint section`);
    }
    const removed = await promptRemoveFile(filePath, name, onCancel);
    if (removed) {
      removedFiles.add(name);
    }
    break;
  }

  if (!migrated.lint) {
    for (const name of OXLINT_JS_CONFIGS) {
      const filePath = join(root, name);
      if (!existsSync(filePath)) {
        continue;
      }

      const parsed = await loadJsConfig(filePath);
      if (parsed) {
        const lint = extractLintConfig(parsed);
        if (Object.keys(lint).length > 0) {
          migrated.lint = lint;
          log.info(`Migrated ${name} into neutron.yml lint section`);
        }
        const removed = await promptRemoveFile(filePath, name, onCancel);
        if (removed) {
          removedFiles.add(name);
        }
      } else {
        log.warn(`Could not load ${name} — migrate manually into the lint section of neutron.yml`);
        const removed = await promptRemoveFile(filePath, name, onCancel);
        if (removed) {
          removedFiles.add(name);
        }
      }
      break;
    }
  }

  // ─── Oxfmt / Prettier ─────────────────────────────────────────────────

  for (const name of OXFMT_JSON_CONFIGS) {
    const filePath = join(root, name);
    const parsed = await readJsonConfig(filePath);
    if (!parsed) {
      continue;
    }

    const format = extractFormatConfig(parsed);
    if (Object.keys(format).length > 0) {
      migrated.format = format;
      log.info(`Migrated ${name} into neutron.yml format section`);
    }
    const removed = await promptRemoveFile(filePath, name, onCancel);
    if (removed) {
      removedFiles.add(name);
    }
    break;
  }

  // ─── Ignore files ─────────────────────────────────────────────────────

  for (const name of IGNORE_FILES) {
    const filePath = join(root, name);
    const patterns = await readIgnorePatterns(filePath);
    if (patterns.length === 0) {
      continue;
    }

    if (!migrated.format) {
      migrated.format = {};
    }
    const existingIgnore = Array.isArray(migrated.format["ignore"])
      ? migrated.format["ignore"]
      : [];
    migrated.format["ignore"] = [...existingIgnore, ...patterns];
    log.info(`Migrated ${name} patterns into neutron.yml format.ignore`);

    const removed = await promptRemoveFile(filePath, name, onCancel);
    if (removed) {
      removedFiles.add(name);
    }
  }

  // ─── Stale file cleanup ────────────────────────────────────────────────

  if (migrated.lint) {
    for (const name of STALE_ESLINT_CONFIGS) {
      if (removedFiles.has(name)) {
        continue;
      }
      const filePath = join(root, name);
      if (!existsSync(filePath)) {
        continue;
      }
      const answer = await confirm({
        message: `${name} found — neutron now uses oxlint. Remove?`,
        initialValue: true,
      });
      if (isCancel(answer)) {
        onCancel();
      }
      if (answer) {
        await unlink(filePath);
        log.step(`Removed ${name}`);
      }
    }
  }

  if (migrated.format) {
    for (const name of STALE_PRETTIER_CONFIGS) {
      if (removedFiles.has(name)) {
        continue;
      }
      const filePath = join(root, name);
      if (!existsSync(filePath)) {
        continue;
      }
      const answer = await confirm({
        message: `${name} found — neutron now uses oxfmt. Remove?`,
        initialValue: true,
      });
      if (isCancel(answer)) {
        onCancel();
      }
      if (answer) {
        await unlink(filePath);
        log.step(`Removed ${name}`);
      }
    }
  }

  return migrated;
}

/**
 * Deep-merge migrated tool config into the generated config.
 * Migrated values override defaults (e.g., migrated rules replace empty rules).
 */
export function mergeMigratedConfig(
  config: Record<string, unknown>,
  migrated: MigratedToolConfig,
): void {
  if (migrated.lint && isRecord(migrated.lint)) {
    const base = isRecord(config["lint"]) ? config["lint"] : {};
    for (const [key, value] of Object.entries(migrated.lint)) {
      if (key === "typescript" && isRecord(value) && isRecord(base["typescript"])) {
        base["typescript"] = { ...base["typescript"], ...value };
      } else {
        base[key] = value;
      }
    }
    config["lint"] = base;
  }
  if (migrated.format && isRecord(migrated.format)) {
    const base = isRecord(config["format"]) ? config["format"] : {};
    for (const [key, value] of Object.entries(migrated.format)) {
      if (key === "typescript" && isRecord(value) && isRecord(base["typescript"])) {
        base["typescript"] = { ...base["typescript"], ...value };
      } else {
        base[key] = value;
      }
    }
    config["format"] = base;
  }
}
