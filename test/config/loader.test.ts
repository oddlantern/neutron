import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { loadConfig } from '../../src/config/loader.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mido-loader-test-'));
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
    writeFileSync(join(tmpDir, 'mido.yml'), MINIMAL_VALID_CONFIG, 'utf-8');
    const loaded = await loadConfig(tmpDir);
    expect(loaded.config.workspace).toBe('test-workspace');
    expect(loaded.root).toBe(tmpDir);
  });

  test('throws when no mido.yml is found', async () => {
    // Use a temp dir that definitely has no mido.yml up the tree
    // We need an isolated directory — use /tmp itself (no mido.yml there)
    const isolated = mkdtempSync(join('/tmp', 'mido-no-config-'));
    try {
      await expect(loadConfig(isolated)).rejects.toThrow('No mido.yml found');
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  test('throws on invalid YAML', async () => {
    writeFileSync(join(tmpDir, 'mido.yml'), '{ invalid yaml: [unclosed', 'utf-8');
    await expect(loadConfig(tmpDir)).rejects.toThrow();
  });

  test('throws on schema validation failure', async () => {
    // Valid YAML but missing required fields
    writeFileSync(join(tmpDir, 'mido.yml'), 'workspace: test\n', 'utf-8');
    await expect(loadConfig(tmpDir)).rejects.toThrow('Invalid mido config');
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
      writeFileSync(join(tmpDir, 'mido.yml'), oldConfig, 'utf-8');
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
      writeFileSync(join(tmpDir, 'mido.yml'), modernConfig, 'utf-8');
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
      writeFileSync(join(tmpDir, 'mido.yml'), oldConfig, 'utf-8');
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
      writeFileSync(join(tmpDir, 'mido.yml'), modernConfig, 'utf-8');
      const first = await loadConfig(tmpDir);
      const second = await loadConfig(tmpDir);

      expect(second.config.lint?.typescript?.categories?.correctness).toBe(
        first.config.lint?.typescript?.categories?.correctness,
      );
    });
  });

  test('walks up directory tree to find mido.yml', async () => {
    writeFileSync(join(tmpDir, 'mido.yml'), MINIMAL_VALID_CONFIG, 'utf-8');
    const subDir = join(tmpDir, 'apps', 'server');
    mkdtempSync(join(tmpDir, 'apps-'));
    // Create the subdir structure
    const { mkdirSync } = await import('node:fs');
    mkdirSync(subDir, { recursive: true });
    const loaded = await loadConfig(subDir);
    expect(loaded.root).toBe(tmpDir);
  });

  test('finds mido.yaml as well as mido.yml', async () => {
    writeFileSync(join(tmpDir, 'mido.yaml'), MINIMAL_VALID_CONFIG, 'utf-8');
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
    - mido pre-commit
  commit-msg:
    - mido commit-msg "$1"
`;
      writeFileSync(join(tmpDir, 'mido.yml'), config, 'utf-8');
      const loaded = await loadConfig(tmpDir);
      expect(loaded.config.hooks?.["pre-commit"]).toEqual(["mido pre-commit"]);
      expect(loaded.config.hooks?.["commit-msg"]).toEqual(['mido commit-msg "$1"']);
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
    - mido commit-msg "$1"
`;
      writeFileSync(join(tmpDir, 'mido.yml'), config, 'utf-8');
      const loaded = await loadConfig(tmpDir);
      expect(loaded.config.hooks?.["pre-commit"]).toBe(false);
    });

    test('omitted hooks section loads fine', async () => {
      writeFileSync(join(tmpDir, 'mido.yml'), MINIMAL_VALID_CONFIG, 'utf-8');
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
      writeFileSync(join(tmpDir, 'mido.yml'), config, 'utf-8');
      await expect(loadConfig(tmpDir)).rejects.toThrow('Invalid mido config');
    });
  });
});
