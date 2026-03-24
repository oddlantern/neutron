import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { Dependency } from '../graph/types.js';
import type { ManifestParser, ParsedManifest } from './types.js';

type DepType = Dependency['type'];

const DEP_FIELDS: readonly (readonly [string, DepType])[] = [
  ['dependencies', 'production'],
  ['dev_dependencies', 'dev'],
  ['dependency_overrides', 'override'],
] as const;

/**
 * Dart dependency values can be:
 * - A string version constraint: "^1.2.3"
 * - A map with path/git/hosted source: { path: ../shared }
 * - null (meaning "any")
 */
function extractDeps(
  manifest: Record<string, unknown>,
  field: string,
  type: DepType,
): Dependency[] {
  const raw = manifest[field];
  if (raw === null || raw === undefined || typeof raw !== 'object') return [];

  const record = raw as Record<string, unknown>;
  const deps: Dependency[] = [];

  for (const [name, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      deps.push({ name, range: value, type });
    } else if (value === null || value === undefined) {
      deps.push({ name, range: 'any', type });
    } else if (typeof value === 'object') {
      // Map-style dependency (path, git, hosted, sdk)
      const depMap = value as Record<string, unknown>;

      if (typeof depMap['version'] === 'string') {
        deps.push({ name, range: depMap['version'], type });
      } else if ('path' in depMap || 'git' in depMap || 'sdk' in depMap) {
        // Path/git/sdk deps don't have a version range to compare
        deps.push({ name, range: '<local>', type });
      } else {
        deps.push({ name, range: 'any', type });
      }
    }
  }

  return deps;
}

function extractLocalPaths(
  manifest: Record<string, unknown>,
  manifestDir: string,
): string[] {
  const paths: string[] = [];

  for (const [field] of DEP_FIELDS) {
    const raw = manifest[field];
    if (raw === null || raw === undefined || typeof raw !== 'object') continue;

    const record = raw as Record<string, unknown>;
    for (const value of Object.values(record)) {
      if (value === null || value === undefined || typeof value !== 'object') continue;

      const depMap = value as Record<string, unknown>;
      if (typeof depMap['path'] === 'string') {
        paths.push(resolve(manifestDir, depMap['path']));
      }
    }
  }

  return paths;
}

export const pubspecParser: ManifestParser = {
  manifestName: 'pubspec.yaml',

  async parse(manifestPath: string): Promise<ParsedManifest> {
    const content = await readFile(manifestPath, 'utf-8');
    const manifest = parseYaml(content) as Record<string, unknown>;

    const name = typeof manifest['name'] === 'string' ? manifest['name'] : '<unnamed>';
    const version = typeof manifest['version'] === 'string' ? manifest['version'] : undefined;

    const dependencies = DEP_FIELDS.flatMap(([field, type]) =>
      extractDeps(manifest, field, type),
    );

    const localDependencyPaths = extractLocalPaths(manifest, dirname(manifestPath));

    return { name, version, dependencies, localDependencyPaths };
  },
};
