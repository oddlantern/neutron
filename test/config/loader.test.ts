import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { loadConfig } from '../../src/config/loader.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neutron-loader-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const MINIMAL_VALID_CONFIG = `
workspace: test-workspace
ecosystems:
  typescript:
    manifest: package.json
    packages:
      - apps/server
`;

describe('loadConfig', () => {
  test('loads a valid minimal config', async () => {
    writeFileSync(join(tmpDir, 'neutron.yml'), MINIMAL_VALID_CONFIG, 'utf-8');
    const loaded = await loadConfig(tmpDir);
    expect(loaded.config.workspace).toBe('test-workspace');
    expect(loaded.root).toBe(tmpDir);
  });

  test('throws when no neutron.yml is found', async () => {
    // Use a temp dir that definitely has no neutron.yml up the tree
    // We need an isolated directory — use /tmp itself (no neutron.yml there)
    const isolated = mkdtempSync(join('/tmp', 'neutron-no-config-'));
    try {
      await expect(loadConfig(isolated)).rejects.toThrow('No neutron.yml found');
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  test('throws on invalid YAML', async () => {
    writeFileSync(join(tmpDir, 'neutron.yml'), '{ invalid yaml: [unclosed', 'utf-8');
    await expect(loadConfig(tmpDir)).rejects.toThrow();
  });

  test('throws on schema validation failure', async () => {
    // Valid YAML but missing required fields
    writeFileSync(join(tmpDir, 'neutron.yml'), 'workspace: test\n', 'utf-8');
    await expect(loadConfig(tmpDir)).rejects.toThrow('Invalid neutron config');
  });

  describe('migration: bridge fields from/to/via → source/target/artifact', () => {
    test('auto-migrates old from/to/via format', async () => {
      const oldConfig = `
workspace: test-workspace
ecosystems:
  typescript:
    manifest: package.json
    packages:
      - apps/server
      - packages/api
bridges:
  - from: apps/server
    to: packages/api
    via: apps/server/openapi.json
`;
      writeFileSync(join(tmpDir, 'neutron.yml'), oldConfig, 'utf-8');
      const loaded = await loadConfig(tmpDir);
      expect(loaded.config.bridges).toHaveLength(1);
      // from=consumer → target, to=producer → source
      expect(loaded.config.bridges?.[0]?.source).toBe('packages/api');
      expect(loaded.config.bridges?.[0]?.artifact).toBe('apps/server/openapi.json');
    });

    test('accepts already-migrated source/target/artifact format', async () => {
      const modernConfig = `
workspace: test-workspace
ecosystems:
  typescript:
    manifest: package.json
    packages:
      - apps/server
      - packages/api
bridges:
  - source: apps/server
    consumers:
      - packages/api
    artifact: apps/server/openapi.json
`;
      writeFileSync(join(tmpDir, 'neutron.yml'), modernConfig, 'utf-8');
      const loaded = await loadConfig(tmpDir);
      expect(loaded.config.bridges).toHaveLength(1);
    });
  });

  describe('migration: flat lint/format → ecosystem-centric', () => {
    test('auto-migrates old flat lint rules format', async () => {
      const oldConfig = `
workspace: test-workspace
ecosystems:
  typescript:
    manifest: package.json
    packages:
      - apps/server
lint:
  rules:
    eqeqeq: warn
  ignore:
    - dist
`;
      writeFileSync(join(tmpDir, 'neutron.yml'), oldConfig, 'utf-8');
      const loaded = await loadConfig(tmpDir);
      expect(loaded.config.lint?.typescript).toBeDefined();
    });

    test('already-migrated ecosystem-centric format is unchanged', async () => {
      const modernConfig = `
workspace: test-workspace
ecosystems:
  typescript:
    manifest: package.json
    packages:
      - apps/server
lint:
  typescript:
    categories:
      correctness: error
`;
      writeFileSync(join(tmpDir, 'neutron.yml'), modernConfig, 'utf-8');
      const first = await loadConfig(tmpDir);
      const second = await loadConfig(tmpDir);

      expect(second.config.lint?.typescript?.categories?.correctness).toBe(
        first.config.lint?.typescript?.categories?.correctness,
      );
    });
  });

  test('walks up directory tree to find neutron.yml', async () => {
    writeFileSync(join(tmpDir, 'neutron.yml'), MINIMAL_VALID_CONFIG, 'utf-8');
    const subDir = join(tmpDir, 'apps', 'server');
    mkdtempSync(join(tmpDir, 'apps-'));
    // Create the subdir structure
    const { mkdirSync } = await import('node:fs');
    mkdirSync(subDir, { recursive: true });
    const loaded = await loadConfig(subDir);
    expect(loaded.root).toBe(tmpDir);
  });

  test('finds neutron.yaml as well as neutron.yml', async () => {
    writeFileSync(join(tmpDir, 'neutron.yaml'), MINIMAL_VALID_CONFIG, 'utf-8');
    const loaded = await loadConfig(tmpDir);
    expect(loaded.config.workspace).toBe('test-workspace');
  });

  describe('hooks config', () => {
    test('accepts valid hooks with command arrays', async () => {
      const config = `
workspace: test-workspace
ecosystems:
  typescript:
    manifest: package.json
    packages:
      - apps/server
hooks:
  pre-commit:
    - neutron pre-commit
  commit-msg:
    - neutron commit-msg "$1"
`;
      writeFileSync(join(tmpDir, 'neutron.yml'), config, 'utf-8');
      const loaded = await loadConfig(tmpDir);
      expect(loaded.config.hooks?.["pre-commit"]).toEqual(["neutron pre-commit"]);
      expect(loaded.config.hooks?.["commit-msg"]).toEqual(['neutron commit-msg "$1"']);
    });

    test('accepts false to disable a hook', async () => {
      const config = `
workspace: test-workspace
ecosystems:
  typescript:
    manifest: package.json
    packages:
      - apps/server
hooks:
  pre-commit: false
  commit-msg:
    - neutron commit-msg "$1"
`;
      writeFileSync(join(tmpDir, 'neutron.yml'), config, 'utf-8');
      const loaded = await loadConfig(tmpDir);
      expect(loaded.config.hooks?.["pre-commit"]).toBe(false);
    });

    test('omitted hooks section loads fine', async () => {
      writeFileSync(join(tmpDir, 'neutron.yml'), MINIMAL_VALID_CONFIG, 'utf-8');
      const loaded = await loadConfig(tmpDir);
      expect(loaded.config.hooks).toBeUndefined();
    });

    test('rejects empty command array', async () => {
      const config = `
workspace: test-workspace
ecosystems:
  typescript:
    manifest: package.json
    packages:
      - apps/server
hooks:
  pre-commit: []
`;
      writeFileSync(join(tmpDir, 'neutron.yml'), config, 'utf-8');
      await expect(loadConfig(tmpDir)).rejects.toThrow('Invalid neutron config');
    });
  });
});
