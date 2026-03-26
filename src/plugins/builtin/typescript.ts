import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import type { FormatTypescriptConfig, LintTypescriptConfig } from "../../config/schema.js";

import type { WorkspacePackage } from "../../graph/types.js";
import { MIDO_ROOT } from "../../version.js";
import type {
  DomainCapability,
  EcosystemPlugin,
  ExecuteResult,
  ExecutionContext,
  WatchPathSuggestion,
} from "../types.js";
import { STANDARD_ACTIONS } from "../types.js";
import { getScripts, hasDep, isRecord, readPackageJson, runCommand } from "./exec.js";
import { generateCSS, generateTS } from "./typescript/token-codegen.js";

const WATCH_PATTERNS: readonly string[] = ["src/**/*.ts", "src/**/*.tsx"];

const WELL_KNOWN_ACTIONS: readonly string[] = ["generate", "build", "dev", "codegen"];

/** Action name for direct openapi-typescript invocation */
const ACTION_GENERATE_OPENAPI_TS = "generate-openapi-ts";

/** Action name for design token CSS/TS generation */
const ACTION_GENERATE_DESIGN_TOKENS_CSS = "generate-design-tokens-css";

/**
 * Parse an openapi-typescript invocation from a package script to extract
 * the input artifact path and output path.
 *
 * Example script: "openapi-typescript ../openapi.prepared.json -o generated/api.d.ts"
 * Returns: { input: "../openapi.prepared.json", output: "generated/api.d.ts" }
 */
function parseOpenapiTsScript(
  scriptValue: string,
): { readonly input: string; readonly output: string } | null {
  // Match: openapi-typescript <input> [flags...] -o <output>
  // Allows arbitrary flags between input and -o (e.g., --enum, --path-params-as-types)
  const pattern = /openapi-typescript\s+(\S+).*?\s(?:-o|--output)\s+(\S+)/;
  const match = pattern.exec(scriptValue);
  if (!match) {
    return null;
  }
  const input = match[1];
  const output = match[2];
  if (!input || !output) {
    return null;
  }
  return { input, output };
}

/**
 * Detect the openapi-typescript output path from existing scripts.
 * Searches generate, openapi:generate, and other scripts for openapi-typescript usage.
 * Returns the output path if found in a script.
 */
function detectOutputFromScripts(scripts: Record<string, string>): string | null {
  // Check scripts in priority order
  const scriptNames = ["generate", "openapi:generate", "generate:ts", "codegen"];
  for (const name of scriptNames) {
    const script = scripts[name];
    if (!script) {
      continue;
    }
    const parsed = parseOpenapiTsScript(script);
    if (parsed) {
      return parsed.output;
    }
  }

  // Check all scripts
  for (const script of Object.values(scripts)) {
    const parsed = parseOpenapiTsScript(script);
    if (parsed) {
      return parsed.output;
    }
  }

  return null;
}

/**
 * Resolve a binary for a TS tool (linter, formatter).
 *
 * Resolution order:
 *  1. Workspace root node_modules — user override takes precedence
 *  2. Mido's own node_modules   — bundled oxlint / oxfmt
 *  3. Fall through (null)        — caller can try bare name on PATH
 */
export function resolveBin(name: string, workspaceRoot: string): string | null {
  const workspaceBin = join(workspaceRoot, "node_modules", ".bin", name);
  if (existsSync(workspaceBin)) {
    return workspaceBin;
  }

  const bundledBin = join(MIDO_ROOT, "node_modules", ".bin", name);
  if (existsSync(bundledBin)) {
    return bundledBin;
  }

  return null;
}

const CACHE_DIR_NAME = "node_modules/.cache/mido";

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
function detectOxlintPlugins(pkg: WorkspacePackage, root: string): readonly string[] {
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
 * Generate a temporary oxlintrc.json from the mido lint.typescript config.
 * Includes categories, rules, and auto-detected plugins.
 * Returns the path to the file, or null if no config is needed.
 */
function writeOxlintConfig(
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
 * Generate a temporary oxfmtrc.json from the mido format.typescript config.
 * Returns the config path, or null if no config is needed.
 */
function writeOxfmtConfig(root: string, format: FormatTypescriptConfig): string | null {
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

/**
 * Find the source directory for a TS package.
 * Prefers src/, falls back to lib/, then package root.
 * When falling back to root, returns it so the caller can decide
 * whether to add glob filters for tools that scan recursively.
 */
function findSourceDir(
  pkg: WorkspacePackage,
  root: string,
): { readonly dir: string; readonly isRoot: boolean } {
  const pkgDir = join(root, pkg.path);
  if (existsSync(join(pkgDir, "src"))) {
    return { dir: join(pkgDir, "src"), isRoot: false };
  }
  if (existsSync(join(pkgDir, "lib"))) {
    return { dir: join(pkgDir, "lib"), isRoot: false };
  }
  return { dir: pkgDir, isRoot: true };
}

/** Well-known output paths for openapi-typescript, checked in order */
const WELL_KNOWN_OUTPUT_PATHS: readonly string[] = [
  "generated/api.d.ts",
  "src/generated/api.d.ts",
  "src/api.d.ts",
];

/**
 * Resolve the output path for openapi-typescript.
 * Priority: existing scripts → existing well-known files → default.
 */
function resolveOutputPath(
  pkg: WorkspacePackage,
  root: string,
  scripts: Record<string, string>,
): string {
  // 1. Parse from existing scripts
  const fromScript = detectOutputFromScripts(scripts);
  if (fromScript) {
    return fromScript;
  }

  // 2. Check well-known output locations
  const pkgDir = join(root, pkg.path);
  for (const candidate of WELL_KNOWN_OUTPUT_PATHS) {
    if (existsSync(join(pkgDir, candidate))) {
      return candidate;
    }
  }

  // 3. Default
  return "generated/api.d.ts";
}

export const typescriptPlugin: EcosystemPlugin = {
  type: "ecosystem",
  name: "typescript",
  manifest: "package.json",

  async detect(pkg: WorkspacePackage): Promise<boolean> {
    return pkg.ecosystem === "typescript";
  },

  async getWatchPatterns(): Promise<readonly string[]> {
    return WATCH_PATTERNS;
  },

  async getActions(pkg: WorkspacePackage, root: string): Promise<readonly string[]> {
    try {
      const manifest = await readPackageJson(pkg.path, root);
      const scripts = getScripts(manifest);
      const actions: string[] = [];

      // Standard actions — always available for TS packages
      actions.push(STANDARD_ACTIONS.LINT);
      actions.push(STANDARD_ACTIONS.FORMAT);
      actions.push(STANDARD_ACTIONS.FORMAT_CHECK);

      // Build — only if there's a build script
      if (scripts["build"]) {
        actions.push(STANDARD_ACTIONS.BUILD);
      }

      // Typecheck — if typescript dep or tsconfig exists
      if (hasDep(manifest, "typescript") || existsSync(join(root, pkg.path, "tsconfig.json"))) {
        actions.push(STANDARD_ACTIONS.TYPECHECK);
      }

      for (const action of WELL_KNOWN_ACTIONS) {
        if (scripts[action] && !actions.includes(action)) {
          actions.push(action);
        }
      }

      // Include non-well-known scripts too
      for (const key of Object.keys(scripts)) {
        if (!actions.includes(key) && !key.startsWith("pre") && !key.startsWith("post")) {
          actions.push(key);
        }
      }

      return actions;
    } catch {
      return [];
    }
  },

  async execute(
    action: string,
    pkg: WorkspacePackage,
    root: string,
    context: ExecutionContext,
  ): Promise<ExecuteResult> {
    const cwd = join(root, pkg.path);
    const pm = context.packageManager;

    // ─── Standard actions ──────────────────────────────────────────────────
    if (action === STANDARD_ACTIONS.LINT || action === STANDARD_ACTIONS.LINT_FIX) {
      const fix = action === STANDARD_ACTIONS.LINT_FIX;
      const oxlint = resolveBin("oxlint", root);
      if (oxlint) {
        const args: string[] = [];

        // Auto-detect plugins and generate config
        const plugins = detectOxlintPlugins(pkg, root);
        const lintTs = context.lintTypescript;
        const configPath = writeOxlintConfig(root, lintTs ?? {}, plugins);
        if (configPath) {
          args.push("--config", configPath);
        }

        if (fix) {
          args.push("--fix");
        }
        if (context.resolvedFiles && context.resolvedFiles.length > 0) {
          args.push(...context.resolvedFiles);
        } else {
          const { dir } = findSourceDir(pkg, root);
          args.push(dir);
        }
        return runCommand(oxlint, args, cwd);
      }
      const eslint = resolveBin("eslint", root);
      if (eslint) {
        if (context.resolvedFiles && context.resolvedFiles.length > 0) {
          const args = fix ? ["--fix", ...context.resolvedFiles] : [...context.resolvedFiles];
          return runCommand(eslint, args, cwd);
        }
        const { dir } = findSourceDir(pkg, root);
        const args = fix ? ["--fix", dir] : [dir];
        return runCommand(eslint, args, cwd);
      }
      return {
        success: true,
        duration: 0,
        summary: `No linter found for ${pkg.path}. Install oxlint or eslint.`,
      };
    }

    if (action === STANDARD_ACTIONS.FORMAT) {
      const oxfmt = resolveBin("oxfmt", root);
      if (oxfmt) {
        const args: string[] = [];
        const fmtTs = context.formatTypescript;
        if (fmtTs) {
          const configPath = writeOxfmtConfig(root, fmtTs);
          if (configPath) {
            args.push("--config", configPath);
          }
        }
        if (context.resolvedFiles && context.resolvedFiles.length > 0) {
          args.push(...context.resolvedFiles);
        } else {
          const { dir, isRoot } = findSourceDir(pkg, root);
          if (isRoot) {
            args.push(
              "--no-error-on-unmatched-pattern",
              join(dir, "**/*.ts"),
              join(dir, "**/*.tsx"),
            );
          } else {
            args.push(dir);
          }
        }
        return runCommand(oxfmt, args, cwd);
      }
      const prettier = resolveBin("prettier", root);
      if (prettier) {
        if (context.resolvedFiles && context.resolvedFiles.length > 0) {
          return runCommand(prettier, ["--write", ...context.resolvedFiles], cwd);
        }
        const { dir } = findSourceDir(pkg, root);
        return runCommand(prettier, ["--write", dir], cwd);
      }
      return {
        success: true,
        duration: 0,
        summary: `No formatter found for ${pkg.path}. Install oxfmt or prettier.`,
      };
    }

    if (action === STANDARD_ACTIONS.FORMAT_CHECK) {
      const oxfmt = resolveBin("oxfmt", root);
      if (oxfmt) {
        const args: string[] = ["--check"];
        const fmtTs = context.formatTypescript;
        if (fmtTs) {
          const configPath = writeOxfmtConfig(root, fmtTs);
          if (configPath) {
            args.push("--config", configPath);
          }
        }
        if (context.resolvedFiles && context.resolvedFiles.length > 0) {
          args.push(...context.resolvedFiles);
        } else {
          const { dir, isRoot } = findSourceDir(pkg, root);
          if (isRoot) {
            args.push(
              "--no-error-on-unmatched-pattern",
              join(dir, "**/*.ts"),
              join(dir, "**/*.tsx"),
            );
          } else {
            args.push(dir);
          }
        }
        return runCommand(oxfmt, args, cwd);
      }
      const prettier = resolveBin("prettier", root);
      if (prettier) {
        if (context.resolvedFiles && context.resolvedFiles.length > 0) {
          return runCommand(prettier, ["--check", ...context.resolvedFiles], cwd);
        }
        const { dir } = findSourceDir(pkg, root);
        return runCommand(prettier, ["--check", dir], cwd);
      }
      return {
        success: true,
        duration: 0,
        summary: `No formatter found for ${pkg.path}. Install oxfmt or prettier.`,
      };
    }

    if (action === STANDARD_ACTIONS.BUILD) {
      return runCommand(pm, ["run", "build"], cwd);
    }

    if (action === STANDARD_ACTIONS.TYPECHECK) {
      // Prefer typecheck script, fall back to tsc --noEmit
      let scripts: Record<string, string> = {};
      try {
        const manifest = await readPackageJson(pkg.path, root);
        scripts = getScripts(manifest);
      } catch {
        // proceed with fallback
      }
      if (scripts["typecheck"]) {
        return runCommand(pm, ["run", "typecheck"], cwd);
      }
      const runner = pm === "bun" ? "bunx" : "npx";
      return runCommand(runner, ["tsc", "--noEmit"], cwd);
    }

    // Design token CSS/TS generation
    if (action === ACTION_GENERATE_DESIGN_TOKENS_CSS) {
      const start = performance.now();

      const tokens = context.tokenData;
      if (!tokens) {
        return {
          success: false,
          duration: 0,
          summary: "No token data provided — design plugin must validate first",
        };
      }

      // Scaffold package.json if first run
      if (!existsSync(join(cwd, "package.json"))) {
        mkdirSync(cwd, { recursive: true });
        const pkgName = pkg.name || "design-tokens";
        const pkgJson = {
          name: pkgName,
          version: "0.0.0",
          private: true,
          main: "generated/tokens.css",
          types: "generated/tokens.ts",
        };
        writeFileSync(join(cwd, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
      }

      const generatedDir = join(cwd, "generated");
      mkdirSync(generatedDir, { recursive: true });

      const cssContent = generateCSS(tokens);
      const tsContent = generateTS(tokens);

      writeFileSync(join(generatedDir, "tokens.css"), cssContent, "utf-8");
      writeFileSync(join(generatedDir, "tokens.ts"), tsContent, "utf-8");

      const duration = Math.round(performance.now() - start);
      return {
        success: true,
        duration,
        summary: "2 files written",
      };
    }

    // Direct openapi-typescript invocation
    if (action === ACTION_GENERATE_OPENAPI_TS) {
      let scripts: Record<string, string> = {};
      try {
        const manifest = await readPackageJson(pkg.path, root);
        scripts = getScripts(manifest);
      } catch {
        // manifest unreadable — proceed with empty scripts
      }

      // Resolve artifact input path (relative to package dir)
      const artifactPath = context.artifactPath;
      if (!artifactPath) {
        // No artifact path from domain plugin — fall back to generate script
        if (scripts["generate"]) {
          return runCommand(pm, ["run", "generate"], cwd);
        }
        return {
          success: false,
          duration: 0,
          summary: `No artifact path provided and no generate script found in ${pkg.path}`,
        };
      }

      const artifactRelative = relative(join(root, pkg.path), join(root, artifactPath));
      const outputPath = resolveOutputPath(pkg, root, scripts);
      const runner = pm === "bun" ? "bunx" : "npx";

      return runCommand(runner, ["openapi-typescript", artifactRelative, "-o", outputPath], cwd);
    }

    return runCommand(pm, ["run", action], cwd);
  },

  async canHandleDomainArtifact(
    domain: string,
    _artifact: string,
    pkg: WorkspacePackage,
    root: string,
  ): Promise<DomainCapability | null> {
    if (domain === "design-tokens") {
      // Accept if target is a TS package or doesn't exist yet (first run)
      const pkgJsonPath = join(root, pkg.path, "package.json");
      if (!existsSync(pkgJsonPath)) {
        return {
          action: ACTION_GENERATE_DESIGN_TOKENS_CSS,
          description: "CSS custom properties + TS constants",
        };
      }
      // Existing TS package — accept
      if (pkg.ecosystem === "typescript") {
        return {
          action: ACTION_GENERATE_DESIGN_TOKENS_CSS,
          description: "CSS custom properties + TS constants",
        };
      }
      return null;
    }

    if (domain !== "openapi") {
      return null;
    }

    try {
      const manifest = await readPackageJson(pkg.path, root);

      // Primary: direct tool invocation via openapi-typescript dependency
      if (hasDep(manifest, "openapi-typescript")) {
        return {
          action: ACTION_GENERATE_OPENAPI_TS,
          description: "TypeScript types via openapi-typescript",
        };
      }

      // Fallback: generate script (last resort)
      const scripts = getScripts(manifest);
      if (scripts["generate"]) {
        return {
          action: "generate",
          description: "Generate via package script",
        };
      }
    } catch {
      // manifest unreadable
    }

    return null;
  },

  async suggestWatchPaths(
    pkg: WorkspacePackage,
    root: string,
  ): Promise<WatchPathSuggestion | null> {
    const srcDir = join(root, pkg.path, "src");
    if (existsSync(srcDir)) {
      return {
        paths: [`${pkg.path}/src/**`],
        reason: `Source directory in ${pkg.path}`,
      };
    }

    return {
      paths: [`${pkg.path}/**`],
      reason: `Package root of ${pkg.path}`,
    };
  },
};
