import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { detectPackageManager } from '../../src/pm-detect.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'mido-test-pm-'));
}

describe('detectPackageManager', () => {
  test('detects bun from bun.lock', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'bun.lock'), '');
    expect(detectPackageManager(dir)).toBe('bun');
  });

  test('detects bun from bun.lockb', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'bun.lockb'), '');
    expect(detectPackageManager(dir)).toBe('bun');
  });

  test('detects pnpm from pnpm-lock.yaml', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(dir)).toBe('pnpm');
  });

  test('detects yarn from yarn.lock', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'yarn.lock'), '');
    expect(detectPackageManager(dir)).toBe('yarn');
  });

  test('detects npm from package-lock.json', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'package-lock.json'), '');
    expect(detectPackageManager(dir)).toBe('npm');
  });

  test('defaults to npm when no lockfile exists', () => {
    const dir = makeTempDir();
    expect(detectPackageManager(dir)).toBe('npm');
  });

  test('prefers bun.lock over other lockfiles', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'bun.lock'), '');
    writeFileSync(join(dir, 'package-lock.json'), '');
    writeFileSync(join(dir, 'yarn.lock'), '');
    expect(detectPackageManager(dir)).toBe('bun');
  });
});
