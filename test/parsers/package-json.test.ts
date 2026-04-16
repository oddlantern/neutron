import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { packageJsonParser } from '../../src/parsers/package-json.js';

function makeTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'neutron-test-pkgjson-')));
}

function writeManifest(dir: string, content: Record<string, unknown>): string {
  const path = join(dir, 'package.json');
  writeFileSync(path, JSON.stringify(content, null, 2));
  return path;
}

describe('packageJsonParser', () => {
  test('manifestName is package.json', () => {
    expect(packageJsonParser.manifestName).toBe('package.json');
  });

  test('parses valid package.json with name and version', async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, {
      name: '@scope/my-lib',
      version: '2.1.0',
      dependencies: { lodash: '^4.17.21' },
    });

    const result = await packageJsonParser.parse(path);

    expect(result.name).toBe('@scope/my-lib');
    expect(result.version).toBe('2.1.0');
  });

  test('extracts dependencies from all groups', async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, {
      name: 'test-pkg',
      dependencies: { express: '^4.0.0' },
      devDependencies: { vitest: '^1.0.0' },
      peerDependencies: { react: '>=18.0.0' },
    });

    const result = await packageJsonParser.parse(path);

    const names = result.dependencies.map((d) => d.name);
    expect(names).toContain('express');
    expect(names).toContain('vitest');
    expect(names).toContain('react');

    const express = result.dependencies.find((d) => d.name === 'express');
    const vitest = result.dependencies.find((d) => d.name === 'vitest');
    const react = result.dependencies.find((d) => d.name === 'react');

    expect(express!.type).toBe('production');
    expect(vitest!.type).toBe('dev');
    expect(react!.type).toBe('peer');
  });

  test('handles missing version field', async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, { name: 'no-version' });

    const result = await packageJsonParser.parse(path);

    expect(result.name).toBe('no-version');
    expect(result.version).toBeUndefined();
  });

  test('handles missing dependencies gracefully', async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, { name: 'bare-pkg', version: '0.0.1' });

    const result = await packageJsonParser.parse(path);

    expect(result.dependencies).toHaveLength(0);
  });

  test('detects file: local dependencies as localDependencyPaths', async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, {
      name: 'consumer',
      dependencies: {
        'local-lib': 'file:../shared',
      },
    });

    const result = await packageJsonParser.parse(path);

    expect(result.localDependencyPaths).toHaveLength(1);
    // file:../shared resolved from the manifest's directory
    expect(result.localDependencyPaths[0]).toContain('shared');
  });

  test('workspace:* dependencies are captured with their range string', async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, {
      name: 'consumer',
      dependencies: {
        'workspace-dep': 'workspace:*',
      },
    });

    const result = await packageJsonParser.parse(path);

    const dep = result.dependencies.find((d) => d.name === 'workspace-dep');
    expect(dep).toBeDefined();
    expect(dep!.range).toBe('workspace:*');
  });
});
