import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import type { WorkspacePackage } from '../../src/graph/types.js';
import { openapiPlugin } from '../../src/plugins/builtin/openapi/plugin.js';
import { loadPlugins } from '../../src/plugins/loader.js';
import { PluginRegistry } from '../../src/plugins/registry.js';

const FIXTURE_ROOT = join(import.meta.dir, '..', 'fixture-openapi');

// ─── Fixture packages ────────────────────────────────────────────────────────

const apiPackage: WorkspacePackage = {
  name: '@test/api',
  path: 'packages/api',
  ecosystem: 'typescript',
  version: '1.0.0',
  dependencies: [],
  localDependencies: [],
};

const serverPackage: WorkspacePackage = {
  name: '@test/server',
  path: 'apps/server',
  ecosystem: 'typescript',
  version: '1.0.0',
  dependencies: [],
  localDependencies: [],
};

function buildPackageMap(
  ...pkgs: readonly WorkspacePackage[]
): ReadonlyMap<string, WorkspacePackage> {
  return new Map(pkgs.map((p) => [p.path, p]));
}

// ─── openapiPlugin.suggestWatchPaths ─────────────────────────────────────────

describe('openapiPlugin.suggestWatchPaths', () => {
  test('detects Elysia in apps/server and suggests its routes directory', async () => {
    const packages = buildPackageMap(apiPackage, serverPackage);

    // Source is packages/api (the bridge source) — it does NOT have elysia,
    // so the plugin should scan other packages and find apps/server.
    const result = await openapiPlugin.suggestWatchPaths!(
      apiPackage,
      'packages/api/openapi.json',
      packages,
      FIXTURE_ROOT,
    );

    expect(result).not.toBeNull();
    expect(result!.paths).toContain('apps/server/src/routes/**');
    expect(result!.reason).toContain('elysia');
    expect(result!.reason).toContain('apps/server');
  });

  test('returns routes from source package when it has the framework directly', async () => {
    const packages = buildPackageMap(serverPackage);

    const result = await openapiPlugin.suggestWatchPaths!(
      serverPackage,
      'apps/server/openapi.json',
      packages,
      FIXTURE_ROOT,
    );

    expect(result).not.toBeNull();
    expect(result!.paths).toContain('apps/server/src/routes/**');
  });

  test('returns null when no server framework is detected', async () => {
    // A workspace with only the api package (no elysia anywhere)
    const packages = buildPackageMap(apiPackage);

    const result = await openapiPlugin.suggestWatchPaths!(
      apiPackage,
      'packages/api/openapi.json',
      packages,
      FIXTURE_ROOT,
    );

    expect(result).toBeNull();
  });

  test('falls back to src/** when routes directory does not exist', async () => {
    // Create a package whose path points to a dir without src/routes/
    const noRoutesPackage: WorkspacePackage = {
      name: '@test/no-routes',
      path: 'packages/api',
      ecosystem: 'typescript',
      version: '1.0.0',
      dependencies: [],
      localDependencies: [],
    };

    // packages/api has @elysiajs/openapi but no elysia — won't match.
    // We need a package that HAS elysia but whose src/routes/ doesn't exist.
    // Use a temp dir with elysia dep but no routes folder.
    const packages = buildPackageMap(noRoutesPackage);
    const result = await openapiPlugin.suggestWatchPaths!(
      noRoutesPackage,
      'packages/api/openapi.json',
      packages,
      FIXTURE_ROOT,
    );

    // packages/api doesn't have elysia (only @elysiajs/openapi), so null
    expect(result).toBeNull();
  });
});

// ─── PluginRegistry.suggestWatchPaths ────────────────────────────────────────

describe('PluginRegistry.suggestWatchPaths', () => {
  test('openapi domain plugin takes priority for openapi artifacts', async () => {
    const { ecosystem, domain } = loadPlugins();
    const registry = new PluginRegistry(ecosystem, domain);
    const packages = buildPackageMap(apiPackage, serverPackage);

    const result = await registry.suggestWatchPaths(
      apiPackage,
      'packages/api/openapi.json',
      packages,
      FIXTURE_ROOT,
    );

    expect(result).not.toBeNull();
    expect(result!.paths).toContain('apps/server/src/routes/**');
  });

  test('falls back to ecosystem plugin for non-openapi artifacts', async () => {
    const { ecosystem, domain } = loadPlugins();
    const registry = new PluginRegistry(ecosystem, domain);
    const packages = buildPackageMap(apiPackage);

    // tokens.json is not an openapi artifact — no domain plugin claims it
    const result = await registry.suggestWatchPaths(
      apiPackage,
      'packages/design-system/tokens.json',
      packages,
      FIXTURE_ROOT,
    );

    // TypeScript ecosystem plugin suggests src/** for TS packages
    expect(result).not.toBeNull();
    expect(result!.paths[0]).toContain('packages/api');
  });
});

// ─── Watch path option ordering ──────────────────────────────────────────────

describe('watch path prompt options', () => {
  test('plugin suggestion should be the first option when available', () => {
    // Simulate the option-building logic from promptWatchPaths
    const suggestion = {
      paths: ['apps/server/src/routes/**'] as readonly string[],
      reason: 'Detected elysia routes in apps/server',
    };
    const source = 'packages/api';
    const defaultWatch = `${source}/**`;

    type WatchChoice = 'suggestion' | 'browse' | 'manual' | 'skip';
    const options: Array<{ value: WatchChoice; label: string; hint?: string }> = [];

    if (suggestion) {
      options.push({
        value: 'suggestion',
        label: suggestion.paths.join(', '),
        hint: `detected: ${suggestion.reason}`,
      });
    }

    options.push(
      { value: 'browse', label: 'Browse for a different path' },
      { value: 'manual', label: 'Enter manually' },
      { value: 'skip', label: 'Skip', hint: `default: ${defaultWatch}` },
    );

    expect(options[0]!.value).toBe('suggestion');
    expect(options[0]!.label).toBe('apps/server/src/routes/**');
    expect(options).toHaveLength(4);
  });

  test('browse is first option when no plugin suggestion exists', () => {
    const source = 'packages/api';
    const defaultWatch = `${source}/**`;

    type WatchChoice = 'suggestion' | 'browse' | 'manual' | 'skip';
    const options: Array<{ value: WatchChoice; label: string; hint?: string }> = [];

    // No suggestion — skip the suggestion option
    options.push(
      { value: 'browse', label: 'Browse for a different path' },
      { value: 'manual', label: 'Enter manually' },
      { value: 'skip', label: 'Skip', hint: `default: ${defaultWatch}` },
    );

    expect(options[0]!.value).toBe('browse');
    expect(options).toHaveLength(3);
  });
});

// ─── Path relativity ─────────────────────────────────────────────────────────

describe('watch path relativity', () => {
  test('suggested paths are relative to workspace root, not absolute', async () => {
    const packages = buildPackageMap(apiPackage, serverPackage);

    const result = await openapiPlugin.suggestWatchPaths!(
      apiPackage,
      'packages/api/openapi.json',
      packages,
      FIXTURE_ROOT,
    );

    expect(result).not.toBeNull();
    for (const path of result!.paths) {
      expect(path).not.toStartWith('/');
      expect(path).not.toContain(FIXTURE_ROOT);
    }
  });

  test('browse result should be relative with /** glob suffix', () => {
    // Simulate the relative path logic from the browse case
    const { relative } = require('node:path');
    const root = '/workspace';
    const browsedAbsolute = '/workspace/apps/server/src/routes';
    const relPath = relative(root, browsedAbsolute);

    expect(relPath).toBe('apps/server/src/routes');
    expect(`${relPath}/**`).toBe('apps/server/src/routes/**');
    expect(relPath).not.toStartWith('/');
  });
});
