import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { buildWorkspaceGraph } from '../../src/graph/workspace.js';
import { packageJsonParser } from '../../src/parsers/package-json.js';
import { pubspecParser } from '../../src/parsers/pubspec.js';
import type { MidoConfig } from '../../src/config/schema.js';

const FIXTURE_CLEAN = join(import.meta.dir, '..', 'fixture-clean');

const parsers = new Map([
  ['package.json', packageJsonParser],
  ['pubspec.yaml', pubspecParser],
]);

const fixtureConfig: MidoConfig = {
  workspace: 'nextsaga',
  ecosystems: {
    typescript: {
      manifest: 'package.json',
      packages: ['apps/server', 'packages/api', 'packages/design-system'],
    },
    dart: {
      manifest: 'pubspec.yaml',
      packages: ['apps/flutter', 'packages/api/clients/dart'],
    },
  },
  bridges: [
    {
      source: 'packages/api',
      consumers: ['packages/api/clients/dart'],
      artifact: 'packages/api/openapi.json',
    },
    {
      source: 'packages/design-system',
      consumers: ['apps/flutter'],
      artifact: 'packages/design-system/tokens.json',
    },
  ],
};

describe('buildWorkspaceGraph', () => {
  test('builds graph with correct package count from fixture-clean', async () => {
    const graph = await buildWorkspaceGraph(fixtureConfig, FIXTURE_CLEAN, parsers);
    // 3 typescript + 2 dart = 5 packages
    expect(graph.packages.size).toBe(5);
  });

  test('packages are keyed by relative path', async () => {
    const graph = await buildWorkspaceGraph(fixtureConfig, FIXTURE_CLEAN, parsers);
    expect(graph.packages.has('apps/server')).toBe(true);
    expect(graph.packages.has('packages/api')).toBe(true);
    expect(graph.packages.has('packages/design-system')).toBe(true);
    expect(graph.packages.has('apps/flutter')).toBe(true);
    expect(graph.packages.has('packages/api/clients/dart')).toBe(true);
  });

  test('package names are read from manifests', async () => {
    const graph = await buildWorkspaceGraph(fixtureConfig, FIXTURE_CLEAN, parsers);
    expect(graph.packages.get('apps/server')?.name).toBe('@nextsaga/server');
    expect(graph.packages.get('packages/api')?.name).toBe('@nextsaga/api');
    expect(graph.packages.get('packages/api/clients/dart')?.name).toBe('nextsaga_api_client');
  });

  test('packages have correct ecosystem assigned', async () => {
    const graph = await buildWorkspaceGraph(fixtureConfig, FIXTURE_CLEAN, parsers);
    expect(graph.packages.get('apps/server')?.ecosystem).toBe('typescript');
    expect(graph.packages.get('apps/flutter')?.ecosystem).toBe('dart');
  });

  test('bridges are correctly assembled from config', async () => {
    const graph = await buildWorkspaceGraph(fixtureConfig, FIXTURE_CLEAN, parsers);
    expect(graph.bridges).toHaveLength(2);
    expect(graph.bridges[0]?.source).toBe('packages/api');
    expect(graph.bridges[0]?.consumers).toContain('packages/api/clients/dart');
  });

  test('workspace name matches config', async () => {
    const graph = await buildWorkspaceGraph(fixtureConfig, FIXTURE_CLEAN, parsers);
    expect(graph.name).toBe('nextsaga');
  });

  test('workspace root is set correctly', async () => {
    const graph = await buildWorkspaceGraph(fixtureConfig, FIXTURE_CLEAN, parsers);
    expect(graph.root).toBe(FIXTURE_CLEAN);
  });

  test('throws when no parser registered for manifest type', async () => {
    const configWithUnknown: MidoConfig = {
      workspace: 'test',
      ecosystems: {
        rust: {
          manifest: 'Cargo.toml',
          packages: ['apps/server'],
        },
      },
    };
    await expect(
      buildWorkspaceGraph(configWithUnknown, FIXTURE_CLEAN, parsers),
    ).rejects.toThrow('No parser registered');
  });

  test('throws when manifest file does not exist', async () => {
    const configBadPath: MidoConfig = {
      workspace: 'test',
      ecosystems: {
        typescript: {
          manifest: 'package.json',
          packages: ['nonexistent/path'],
        },
      },
    };
    await expect(
      buildWorkspaceGraph(configBadPath, FIXTURE_CLEAN, parsers),
    ).rejects.toThrow();
  });
});
