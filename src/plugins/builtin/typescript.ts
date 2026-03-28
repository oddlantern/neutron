import { existsSync } from "node:fs";
import { join } from "node:path";

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
import { getScripts, hasDep, hasResolvedFiles, readPackageJson, runCommand } from "./exec.js";
import { executeDesignTokenGeneration, executeOpenAPICodegen } from "./typescript-codegen.js";
import { detectOxlintPlugins, writeOxfmtConfig, writeOxlintConfig } from "./typescript/lint-config.js";

const WATCH_PATTERNS: readonly string[] = ["src/**/*.ts", "src/**/*.tsx"];

const WELL_KNOWN_ACTIONS: readonly string[] = ["generate", "build", "dev", "codegen"];

/** Action name for direct openapi-typescript invocation */
const ACTION_GENERATE_OPENAPI_TS = "generate-openapi-ts";

/** Action name for design token CSS/TS generation */
const ACTION_GENERATE_DESIGN_TOKENS_CSS = "generate-design-tokens-css";

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

function executeFormat(
  pkg: WorkspacePackage,
  root: string,
  cwd: string,
  context: ExecutionContext,
  check: boolean,
): Promise<ExecuteResult> | ExecuteResult {
  const oxfmt = resolveBin("oxfmt", root);
  if (oxfmt) {
    const args: string[] = check ? ["--check"] : [];
    const fmtTs = context.formatTypescript;
    if (fmtTs) {
      const configPath = writeOxfmtConfig(root, fmtTs);
      if (configPath) {
        args.push("--config", configPath);
      }
    }
    if (hasResolvedFiles(context)) {
      args.push(...context.resolvedFiles!);
    } else {
      const { dir, isRoot } = findSourceDir(pkg, root);
      if (isRoot) {
        args.push("--no-error-on-unmatched-pattern", join(dir, "**/*.ts"), join(dir, "**/*.tsx"));
      } else {
        args.push(dir);
      }
    }
    return runCommand(oxfmt, args, cwd);
  }

  const prettier = resolveBin("prettier", root);
  if (prettier) {
    const flag = check ? "--check" : "--write";
    if (hasResolvedFiles(context)) {
      return runCommand(prettier, [flag, ...context.resolvedFiles!], cwd);
    }
    const { dir } = findSourceDir(pkg, root);
    return runCommand(prettier, [flag, dir], cwd);
  }

  return { success: true, duration: 0, summary: `No formatter found for ${pkg.path}. Install oxfmt or prettier.` };
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

      // Test — if there's a test script
      if (scripts["test"]) {
        actions.push(STANDARD_ACTIONS.TEST);
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
        if (hasResolvedFiles(context)) {
          args.push(...context.resolvedFiles);
        } else {
          const { dir } = findSourceDir(pkg, root);
          args.push(dir);
        }
        return runCommand(oxlint, args, cwd);
      }
      const eslint = resolveBin("eslint", root);
      if (eslint) {
        if (hasResolvedFiles(context)) {
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

    if (action === STANDARD_ACTIONS.FORMAT || action === STANDARD_ACTIONS.FORMAT_CHECK) {
      const check = action === STANDARD_ACTIONS.FORMAT_CHECK;
      return executeFormat(pkg, root, cwd, context, check);
    }

    if (action === STANDARD_ACTIONS.BUILD) {
      return runCommand(pm, ["run", "build"], cwd);
    }

    if (action === STANDARD_ACTIONS.TEST) {
      return runCommand(pm, ["run", "test"], cwd);
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
      return executeDesignTokenGeneration(pkg, root, context);
    }

    // Direct openapi-typescript invocation
    if (action === ACTION_GENERATE_OPENAPI_TS) {
      return executeOpenAPICodegen(pkg, root, context);
    }

    // Fallback: delegate to package manager script
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

    // Always accept openapi for TS consumers — mido runs openapi-typescript
    // directly via npx/bunx when using the outputDir convention
    if (pkg.ecosystem === "typescript") {
      return {
        action: ACTION_GENERATE_OPENAPI_TS,
        description: "TypeScript types via openapi-typescript",
      };
    }

    try {
      const manifest = await readPackageJson(pkg.path, root);

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
