import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { WorkspacePackage } from '../../graph/types.js';
import type {
  DomainCapability,
  EcosystemPlugin,
  ExecuteResult,
  ExecutionContext,
  WatchPathSuggestion,
} from '../types.js';
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
 * Detect the openapi-typescript invocation parameters from the package's scripts.
 * Searches generate, openapi:generate, and other scripts for openapi-typescript usage.
 */
async function detectOpenapiTsConfig(
  pkg: WorkspacePackage,
  root: string,
): Promise<{ readonly input: string; readonly output: string } | null> {
  try {
    const manifest = await readPackageJson(pkg.path, root);
    const scripts = getScripts(manifest);

    // Check scripts in priority order
    const scriptNames = ['generate', 'openapi:generate', 'generate:ts', 'codegen'];
    for (const name of scriptNames) {
      const script = scripts[name];
      if (!script) {
        continue;
      }
      const parsed = parseOpenapiTsScript(script);
      if (parsed) {
        return parsed;
      }
    }

    // Fallback: check all scripts
    for (const script of Object.values(scripts)) {
      const parsed = parseOpenapiTsScript(script);
      if (parsed) {
        return parsed;
      }
    }
  } catch {
    // manifest unreadable
  }

  return null;
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

      for (const action of WELL_KNOWN_ACTIONS) {
        if (scripts[action]) {
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

    // Direct openapi-typescript invocation
    if (action === 'generate-openapi-ts') {
      const config = await detectOpenapiTsConfig(pkg, root);

      if (config) {
        // Run openapi-typescript directly with detected paths
        return runCommand(
          pm === 'bun' ? 'bunx' : 'npx',
          ['openapi-typescript', config.input, '-o', config.output],
          cwd,
        );
      }

      // Fallback: try running the generate script
      return runCommand(pm, ['run', 'generate'], cwd);
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
      if (hasDep(manifest, 'openapi-typescript')) {
        return {
          action: 'generate-openapi-ts',
          description: 'TypeScript types via openapi-typescript',
        };
      }

      // Check for a generate script as fallback
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
