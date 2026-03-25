import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';

import type { WorkspacePackage } from '../../graph/types.js';
import type {
  DomainCapability,
  EcosystemPlugin,
  ExecuteResult,
  WatchPathSuggestion,
} from '../types.js';
import { isRecord, runCommand } from './exec.js';

const WATCH_PATTERNS: readonly string[] = ['lib/**/*.dart', 'bin/**/*.dart'];

async function readPubspec(pkg: WorkspacePackage, root: string): Promise<Record<string, unknown>> {
  const manifestPath = join(root, pkg.path, 'pubspec.yaml');
  const content = await readFile(manifestPath, 'utf-8');
  const parsed: unknown = parseYaml(content);
  if (!isRecord(parsed)) {
    throw new Error(`Expected object in ${manifestPath}`);
  }
  return parsed;
}

function hasDep(manifest: Record<string, unknown>, name: string): boolean {
  const fields = ['dependencies', 'dev_dependencies', 'dependency_overrides'];
  for (const field of fields) {
    const deps = manifest[field];
    if (isRecord(deps) && name in deps) {
      return true;
    }
  }
  return false;
}

function isFlutterPackage(manifest: Record<string, unknown>): boolean {
  const deps = manifest['dependencies'];
  if (!isRecord(deps)) {
    return false;
  }
  return 'flutter' in deps;
}

export const dartPlugin: EcosystemPlugin = {
  type: 'ecosystem',
  name: 'dart',
  manifest: 'pubspec.yaml',

  async detect(pkg: WorkspacePackage): Promise<boolean> {
    return pkg.ecosystem === 'dart';
  },

  async getWatchPatterns(): Promise<readonly string[]> {
    return WATCH_PATTERNS;
  },

  async getActions(pkg: WorkspacePackage, root: string): Promise<readonly string[]> {
    try {
      const manifest = await readPubspec(pkg, root);
      const actions: string[] = ['pub-get'];

      if (hasDep(manifest, 'build_runner')) {
        actions.push('codegen');
      }

      if (hasDep(manifest, 'swagger_parser')) {
        actions.push('generate-api');
      }

      return actions;
    } catch {
      return ['pub-get'];
    }
  },

  async execute(action: string, pkg: WorkspacePackage, root: string): Promise<ExecuteResult> {
    const cwd = join(root, pkg.path);

    let manifest: Record<string, unknown>;
    try {
      manifest = await readPubspec(pkg, root);
    } catch {
      manifest = {};
    }

    const flutter = isFlutterPackage(manifest);
    const dartCmd = flutter ? 'flutter' : 'dart';

    switch (action) {
      case 'pub-get':
        return runCommand(dartCmd, ['pub', 'get'], cwd);

      case 'codegen':
        return runCommand(
          'dart',
          ['run', 'build_runner', 'build', '--delete-conflicting-outputs'],
          cwd,
        );

      case 'generate-api':
        return runCommand('dart', ['run', 'swagger_parser'], cwd);

      case 'generate-openapi-dart': {
        // Run swagger_parser then build_runner
        const swaggerResult = await runCommand('dart', ['run', 'swagger_parser'], cwd);
        if (!swaggerResult.success) {
          return swaggerResult;
        }
        return runCommand(
          'dart',
          ['run', 'build_runner', 'build', '--delete-conflicting-outputs'],
          cwd,
        );
      }

      default:
        return {
          success: false,
          duration: 0,
          summary: `Unknown action: ${action}`,
        };
    }
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
      const manifest = await readPubspec(pkg, root);
      if (hasDep(manifest, 'swagger_parser')) {
        return {
          action: 'generate-openapi-dart',
          description: 'Dart client via swagger_parser + build_runner',
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
    const libDir = join(root, pkg.path, 'lib');
    if (existsSync(libDir)) {
      return {
        paths: [`${pkg.path}/lib/**`],
        reason: `Dart source in ${pkg.path}/lib/`,
      };
    }

    return {
      paths: [`${pkg.path}/**`],
      reason: `Package root of ${pkg.path}`,
    };
  },
};
