import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { WorkspacePackage } from '../../graph/types.js';
import type {
  DomainCapability,
  EcosystemPlugin,
  ExecuteResult,
  ExecutionContext,
} from '../types.js';
import { isRecord, runCommand } from './exec.js';

const WATCH_PATTERNS: readonly string[] = [
  'src/**/*.ts',
  'src/**/*.tsx',
];

const WELL_KNOWN_ACTIONS: readonly string[] = [
  'generate',
  'build',
  'dev',
  'codegen',
];

async function readPackageJson(
  pkg: WorkspacePackage,
  root: string,
): Promise<Record<string, unknown>> {
  const manifestPath = join(root, pkg.path, 'package.json');
  const content = await readFile(manifestPath, 'utf-8');
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error(`Expected object in ${manifestPath}`);
  }
  return parsed;
}

function getScripts(manifest: Record<string, unknown>): Record<string, string> {
  const scripts = manifest['scripts'];
  if (!isRecord(scripts)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

function hasDep(
  manifest: Record<string, unknown>,
  name: string,
): boolean {
  const fields = ['dependencies', 'devDependencies', 'peerDependencies'];
  for (const field of fields) {
    const deps = manifest[field];
    if (isRecord(deps) && name in deps) {
      return true;
    }
  }
  return false;
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
      const manifest = await readPackageJson(pkg, root);
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
      const manifest = await readPackageJson(pkg, root);
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
};
