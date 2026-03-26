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
    test('migrates old from/to/via bridge fields to source/target/artifact', async () => {
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
      const bridge = loaded.config.bridges![0];
      expect(bridge.source).toBe('apps/server');
      expect(bridge.target).toBe('packages/api');
      expect(bridge.artifact).toBe('apps/server/openapi.json');
    });

    test('migration is idempotent: running loadConfig again produces identical output', async () => {
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

      const first = await loadConfig(tmpDir);
      const second = await loadConfig(tmpDir);

      expect(second.config.bridges![0]?.source).toBe(first.config.bridges![0]?.source);
      expect(second.config.bridges![0]?.target).toBe(first.config.bridges![0]?.target);
      expect(second.config.bridges![0]?.artifact).toBe(first.config.bridges![0]?.artifact);
    });
  });

  describe('migration: flat lint/format → ecosystem-centric', () => {
    test('migrates old flat lint rules to typescript-nested format', async () => {
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

      // After migration, rules should be nested under lint.typescript
      expect(loaded.config.lint?.typescript?.rules).toBeDefined();
    });

    test('already-migrated config with ecosystem-centric format is unchanged', async () => {
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
});
