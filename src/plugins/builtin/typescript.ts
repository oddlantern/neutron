import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { WorkspacePackage } from '../../graph/types.js';
import type {
  DomainCapability,
  EcosystemPlugin,
  ExecuteResult,
  ExecutionContext,
  WatchPathSuggestion,
} from '../types.js';
import { STANDARD_ACTIONS } from '../types.js';
import { getScripts, hasDep, readPackageJson, runCommand } from './exec.js';

const WATCH_PATTERNS: readonly string[] = ['src/**/*.ts', 'src/**/*.tsx'];

const WELL_KNOWN_ACTIONS: readonly string[] = ['generate', 'build', 'dev', 'codegen'];

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
  const scriptNames = ['generate', 'openapi:generate', 'generate:ts', 'codegen'];
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
 * Resolve a binary from node_modules/.bin/ or fall back to PATH.
 * Returns the bin name if found, null if not available.
 */
function resolveBin(name: string, root: string): string | null {
  const localBin = join(root, 'node_modules', '.bin', name);
  if (existsSync(localBin)) {
    return localBin;
  }
  // Fall through — caller can try the bare name (relies on PATH)
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
  if (existsSync(join(pkgDir, 'src'))) {
    return { dir: join(pkgDir, 'src'), isRoot: false };
  }
  if (existsSync(join(pkgDir, 'lib'))) {
    return { dir: join(pkgDir, 'lib'), isRoot: false };
  }
  return { dir: pkgDir, isRoot: true };
}

/** Well-known output paths for openapi-typescript, checked in order */
const WELL_KNOWN_OUTPUT_PATHS: readonly string[] = [
  'generated/api.d.ts',
  'src/generated/api.d.ts',
  'src/api.d.ts',
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
  return 'generated/api.d.ts';
}

export const typescriptPlugin: EcosystemPlugin = {
  type: 'ecosystem',
  name: 'typescript',
  manifest: 'package.json',

  async detect(pkg: WorkspacePackage): Promise<boolean> {
    return pkg.ecosystem === 'typescript';
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
      if (scripts['build']) {
        actions.push(STANDARD_ACTIONS.BUILD);
      }

      // Typecheck — if typescript dep or tsconfig exists
      if (hasDep(manifest, 'typescript') || existsSync(join(root, pkg.path, 'tsconfig.json'))) {
        actions.push(STANDARD_ACTIONS.TYPECHECK);
      }

      for (const action of WELL_KNOWN_ACTIONS) {
        if (scripts[action] && !actions.includes(action)) {
          actions.push(action);
        }
      }

      // Include non-well-known scripts too
      for (const key of Object.keys(scripts)) {
        if (!actions.includes(key) && !key.startsWith('pre') && !key.startsWith('post')) {
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
      const { dir } = findSourceDir(pkg, root);
      const oxlint = resolveBin('oxlint', root);
      if (oxlint) {
        const args = fix ? ['--fix', dir] : [dir];
        return runCommand(oxlint, args, cwd);
      }
      const eslint = resolveBin('eslint', root);
      if (eslint) {
        const args = fix ? ['--fix', dir] : [dir];
        return runCommand(eslint, args, cwd);
      }
      return {
        success: true,
        duration: 0,
        summary: `No linter found for ${pkg.path}. Install oxlint or eslint.`,
      };
    }

    if (action === STANDARD_ACTIONS.FORMAT) {
      const { dir, isRoot } = findSourceDir(pkg, root);
      const oxfmt = resolveBin('oxfmt', root);
      if (oxfmt) {
        // When targeting the package root (no src/ or lib/), use TS-only globs
        // to avoid formatting JSON/Dart in nested subdirectories.
        // --no-error-on-unmatched-pattern prevents failure when no TS files exist.
        const args = isRoot
          ? ['--no-error-on-unmatched-pattern', join(dir, '**/*.ts'), join(dir, '**/*.tsx')]
          : [dir];
        return runCommand(oxfmt, args, cwd);
      }
      const prettier = resolveBin('prettier', root);
      if (prettier) {
        return runCommand(prettier, ['--write', dir], cwd);
      }
      return {
        success: true,
        duration: 0,
        summary: `No formatter found for ${pkg.path}. Install oxfmt or prettier.`,
      };
    }

    if (action === STANDARD_ACTIONS.FORMAT_CHECK) {
      const { dir, isRoot } = findSourceDir(pkg, root);
      const oxfmt = resolveBin('oxfmt', root);
      if (oxfmt) {
        const args = isRoot
          ? [
              '--check',
              '--no-error-on-unmatched-pattern',
              join(dir, '**/*.ts'),
              join(dir, '**/*.tsx'),
            ]
          : ['--check', dir];
        return runCommand(oxfmt, args, cwd);
      }
      const prettier = resolveBin('prettier', root);
      if (prettier) {
        return runCommand(prettier, ['--check', dir], cwd);
      }
      return {
        success: true,
        duration: 0,
        summary: `No formatter found for ${pkg.path}. Install oxfmt or prettier.`,
      };
    }

    if (action === STANDARD_ACTIONS.BUILD) {
      return runCommand(pm, ['run', 'build'], cwd);
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
      if (scripts['typecheck']) {
        return runCommand(pm, ['run', 'typecheck'], cwd);
      }
      const runner = pm === 'bun' ? 'bunx' : 'npx';
      return runCommand(runner, ['tsc', '--noEmit'], cwd);
    }

    // Direct openapi-typescript invocation
    if (action === 'generate-openapi-ts') {
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
        if (scripts['generate']) {
          return runCommand(pm, ['run', 'generate'], cwd);
        }
        return {
          success: false,
          duration: 0,
          summary: `No artifact path provided and no generate script found in ${pkg.path}`,
        };
      }

      const artifactRelative = relative(join(root, pkg.path), join(root, artifactPath));
      const outputPath = resolveOutputPath(pkg, root, scripts);
      const runner = pm === 'bun' ? 'bunx' : 'npx';

      return runCommand(runner, ['openapi-typescript', artifactRelative, '-o', outputPath], cwd);
    }

    return runCommand(pm, ['run', action], cwd);
  },

  async canHandleDomainArtifact(
    domain: string,
    _artifact: string,
    pkg: WorkspacePackage,
    root: string,
  ): Promise<DomainCapability | null> {
    if (domain !== 'openapi') {
      return null;
    }

    try {
      const manifest = await readPackageJson(pkg.path, root);

      // Primary: direct tool invocation via openapi-typescript dependency
      if (hasDep(manifest, 'openapi-typescript')) {
        return {
          action: 'generate-openapi-ts',
          description: 'TypeScript types via openapi-typescript',
        };
      }

      // Fallback: generate script (last resort)
      const scripts = getScripts(manifest);
      if (scripts['generate']) {
        return {
          action: 'generate',
          description: 'Generate via package script',
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
    const srcDir = join(root, pkg.path, 'src');
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
