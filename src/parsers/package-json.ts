import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import type { Dependency } from '../graph/types.js';
import type { ManifestParser, ParsedManifest } from './types.js';

type DepType = Dependency['type'];

const DEP_FIELDS: readonly (readonly [string, DepType])[] = [
  ['dependencies', 'production'],
  ['devDependencies', 'dev'],
  ['peerDependencies', 'peer'],
  ['optionalDependencies', 'optional'],
] as const;

const manifestSchema = z.record(z.string(), z.unknown());

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractDeps(
  manifest: Record<string, unknown>,
  field: string,
  type: DepType,
): Dependency[] {
  const raw = manifest[field];
  if (!isRecord(raw)) {
    return [];
  }

  return Object.entries(raw)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, range]) => ({ name, range, type }));
}

function extractLocalPaths(manifest: Record<string, unknown>, manifestDir: string): string[] {
  const paths: string[] = [];

  for (const [field] of DEP_FIELDS) {
    const raw = manifest[field];
    if (!isRecord(raw)) {
      continue;
    }

    for (const value of Object.values(raw)) {
      if (typeof value !== 'string') {
        continue;
      }

      // Detect path dependencies: "file:../path", "link:../path", "workspace:*"
      if (value.startsWith('file:')) {
        paths.push(resolve(manifestDir, value.slice(5)));
      } else if (value.startsWith('link:')) {
        paths.push(resolve(manifestDir, value.slice(5)));
      }
    }
  }

  return paths;
}

export const packageJsonParser: ManifestParser = {
  manifestName: 'package.json',

  async parse(manifestPath: string): Promise<ParsedManifest> {
    const content = await readFile(manifestPath, 'utf-8');
    const manifest = manifestSchema.parse(JSON.parse(content));

    const name = typeof manifest['name'] === 'string' ? manifest['name'] : '<unnamed>';
    const version = typeof manifest['version'] === 'string' ? manifest['version'] : undefined;

    const dependencies = DEP_FIELDS.flatMap(([field, type]) => extractDeps(manifest, field, type));

    const localDependencyPaths = extractLocalPaths(manifest, dirname(manifestPath));

    return { name, version, dependencies, localDependencyPaths };
  },
};
