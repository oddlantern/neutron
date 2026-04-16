import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import type { DiscoveredPackage } from '../../src/discovery/scanner.js';
import { classifyPackage, detectBridges } from '../../src/discovery/heuristics.js';

function makeTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'neutron-test-heuristics-')));
}

describe('classifyPackage', () => {
  test('"apps/server" classifies as app', () => {
    expect(classifyPackage('apps/server')).toBe('app');
  });

  test('"app/mobile" classifies as app', () => {
    expect(classifyPackage('app/mobile')).toBe('app');
  });

  test('"packages/lib" classifies as lib', () => {
    expect(classifyPackage('packages/lib')).toBe('lib');
  });

  test('"libs/shared" classifies as lib', () => {
    expect(classifyPackage('libs/shared')).toBe('lib');
  });

  test('"lib/utils" classifies as lib', () => {
    expect(classifyPackage('lib/utils')).toBe('lib');
  });

  test('"random" returns null', () => {
    expect(classifyPackage('random')).toBeNull();
  });

  test('"services/api" returns null', () => {
    expect(classifyPackage('services/api')).toBeNull();
  });
});

describe('detectBridges', () => {
  test('finds artifact file between cross-ecosystem sibling packages', async () => {
    const root = makeTempDir();

    // Create two sibling packages under packages/
    const serverDir = join(root, 'packages', 'server');
    const clientDir = join(root, 'packages', 'client');
    mkdirSync(serverDir, { recursive: true });
    mkdirSync(clientDir, { recursive: true });

    // Place an openapi.json artifact in the server package
    writeFileSync(join(serverDir, 'openapi.json'), '{}');

    const packages: DiscoveredPackage[] = [
      { path: 'packages/server', ecosystem: 'typescript', manifest: 'package.json', supported: true },
      { path: 'packages/client', ecosystem: 'dart', manifest: 'pubspec.yaml', supported: true },
    ];

    const bridges = await detectBridges(root, packages);

    expect(bridges.length).toBeGreaterThanOrEqual(1);

    const bridge = bridges.find(
      (b) => b.source === 'packages/server' && b.consumers.includes('packages/client'),
    );
    expect(bridge).toBeDefined();
    expect(bridge!.artifact).toContain('openapi.json');
  });

  test('does not bridge same-ecosystem packages', async () => {
    const root = makeTempDir();

    const pkgA = join(root, 'packages', 'lib-a');
    const pkgB = join(root, 'packages', 'lib-b');
    mkdirSync(pkgA, { recursive: true });
    mkdirSync(pkgB, { recursive: true });

    writeFileSync(join(pkgA, 'openapi.json'), '{}');

    const packages: DiscoveredPackage[] = [
      { path: 'packages/lib-a', ecosystem: 'typescript', manifest: 'package.json', supported: true },
      { path: 'packages/lib-b', ecosystem: 'typescript', manifest: 'package.json', supported: true },
    ];

    const bridges = await detectBridges(root, packages);

    const sameBridge = bridges.find(
      (b) => b.source === 'packages/lib-a' && b.target === 'packages/lib-b',
    );
    expect(sameBridge).toBeUndefined();
  });

  test('does not bridge unrelated packages in different directories', async () => {
    const root = makeTempDir();

    const serverDir = join(root, 'apps', 'server');
    const clientDir = join(root, 'tools', 'client');
    mkdirSync(serverDir, { recursive: true });
    mkdirSync(clientDir, { recursive: true });

    writeFileSync(join(serverDir, 'openapi.json'), '{}');

    const packages: DiscoveredPackage[] = [
      { path: 'apps/server', ecosystem: 'typescript', manifest: 'package.json', supported: true },
      { path: 'tools/client', ecosystem: 'dart', manifest: 'pubspec.yaml', supported: true },
    ];

    const bridges = await detectBridges(root, packages);

    // apps/server and tools/client are not siblings and not nested
    const bridge = bridges.find(
      (b) => b.source === 'apps/server' && b.target === 'tools/client',
    );
    expect(bridge).toBeUndefined();
  });
});
