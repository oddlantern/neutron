import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { resolveBin } from '../../src/plugins/builtin/ecosystem/typescript/plugin.js';
import { MIDO_ROOT } from '../../src/version.js';

/**
 * Create a fake binary at node_modules/.bin/<name> inside the given root.
 */
function placeBin(root: string, name: string): string {
  const binDir = join(root, 'node_modules', '.bin');
  mkdirSync(binDir, { recursive: true });
  const binPath = join(binDir, name);
  writeFileSync(binPath, '#!/usr/bin/env node\n', { mode: 0o755 });
  return binPath;
}

describe('resolveBin', () => {
  const workspaceRoot = join(tmpdir(), `mido-resolve-bin-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(workspaceRoot, { recursive: true });
  });

  afterAll(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test('prefers workspace version over bundled', () => {
    const wsBin = placeBin(workspaceRoot, 'oxlint');
    const resolved = resolveBin('oxlint', workspaceRoot);
    expect(resolved).toBe(wsBin);
  });

  test('falls back to bundled when workspace lacks the tool', () => {
    // Use a fresh temp dir with no node_modules
    const emptyRoot = join(tmpdir(), `mido-resolve-empty-${Date.now()}`);
    mkdirSync(emptyRoot, { recursive: true });

    const resolved = resolveBin('oxlint', emptyRoot);
    // Should resolve to mido's own bundled oxlint
    const expected = join(MIDO_ROOT, 'node_modules', '.bin', 'oxlint');
    expect(resolved).toBe(expected);

    rmSync(emptyRoot, { recursive: true, force: true });
  });

  test('returns null when tool is not found anywhere', () => {
    const emptyRoot = join(tmpdir(), `mido-resolve-none-${Date.now()}`);
    mkdirSync(emptyRoot, { recursive: true });

    const resolved = resolveBin('nonexistent-tool-xyz', emptyRoot);
    expect(resolved).toBeNull();

    rmSync(emptyRoot, { recursive: true, force: true });
  });
});
