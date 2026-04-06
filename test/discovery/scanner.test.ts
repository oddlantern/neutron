import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { scanRepo } from '../../src/discovery/scanner.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mido-scanner-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function mkdir(relPath: string): string {
  const abs = join(tmpDir, relPath);
  mkdirSync(abs, { recursive: true });
  return abs;
}

function touch(relPath: string, content = ''): void {
  const abs = join(tmpDir, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

describe('scanRepo', () => {
  test('finds package.json packages', async () => {
    mkdir('apps/server');
    touch('apps/server/package.json', JSON.stringify({ name: 'server' }));

    const packages = await scanRepo(tmpDir);
    expect(packages.some((p) => p.path === 'apps/server')).toBe(true);
    expect(packages.find((p) => p.path === 'apps/server')?.ecosystem).toBe('typescript');
    expect(packages.find((p) => p.path === 'apps/server')?.manifest).toBe('package.json');
    expect(packages.find((p) => p.path === 'apps/server')?.supported).toBe(true);
  });

  test('finds pubspec.yaml packages', async () => {
    mkdir('apps/flutter');
    touch('apps/flutter/pubspec.yaml', 'name: flutter_app\n');

    const packages = await scanRepo(tmpDir);
    expect(packages.some((p) => p.path === 'apps/flutter')).toBe(true);
    expect(packages.find((p) => p.path === 'apps/flutter')?.ecosystem).toBe('dart');
    expect(packages.find((p) => p.path === 'apps/flutter')?.supported).toBe(true);
  });

  test('skips node_modules directory', async () => {
    mkdir('apps/server');
    touch('apps/server/package.json', JSON.stringify({ name: 'server' }));
    mkdir('node_modules/some-pkg');
    touch('node_modules/some-pkg/package.json', JSON.stringify({ name: 'some-pkg' }));

    const packages = await scanRepo(tmpDir);
    expect(packages.some((p) => p.path.includes('node_modules'))).toBe(false);
    expect(packages.some((p) => p.path === 'apps/server')).toBe(true);
  });

  test('skips build directory', async () => {
    mkdir('apps/server');
    touch('apps/server/package.json', JSON.stringify({ name: 'server' }));
    mkdir('build/output');
    touch('build/output/package.json', JSON.stringify({ name: 'output' }));

    const packages = await scanRepo(tmpDir);
    expect(packages.some((p) => p.path.startsWith('build'))).toBe(false);
  });

  test('skips dist directory', async () => {
    mkdir('apps/server');
    touch('apps/server/package.json', JSON.stringify({ name: 'server' }));
    mkdir('dist');
    touch('dist/package.json', JSON.stringify({ name: 'dist-pkg' }));

    const packages = await scanRepo(tmpDir);
    expect(packages.some((p) => p.path.startsWith('dist'))).toBe(false);
  });

  test('skips .git directory', async () => {
    mkdir('apps/server');
    touch('apps/server/package.json', JSON.stringify({ name: 'server' }));
    mkdir('.git/hooks');
    touch('.git/hooks/package.json', JSON.stringify({ name: 'git-hooks' }));

    const packages = await scanRepo(tmpDir);
    expect(packages.some((p) => p.path.includes('.git'))).toBe(false);
  });

  test('finds multiple packages across ecosystem types', async () => {
    mkdir('apps/server');
    touch('apps/server/package.json', JSON.stringify({ name: 'server' }));
    mkdir('apps/flutter');
    touch('apps/flutter/pubspec.yaml', 'name: flutter_app\n');
    mkdir('packages/shared');
    touch('packages/shared/package.json', JSON.stringify({ name: 'shared' }));

    const packages = await scanRepo(tmpDir);
    expect(packages.length).toBeGreaterThanOrEqual(3);

    const paths = packages.map((p) => p.path);
    expect(paths).toContain('apps/server');
    expect(paths).toContain('apps/flutter');
    expect(paths).toContain('packages/shared');
  });

  test('returns empty array when no packages found', async () => {
    const packages = await scanRepo(tmpDir);
    expect(packages).toHaveLength(0);
  });

  test('marks rust ecosystem as supported', async () => {
    mkdir('apps/rust-service');
    touch('apps/rust-service/Cargo.toml', '[package]\nname = "rust-service"\n');

    const packages = await scanRepo(tmpDir);
    const rustPkg = packages.find((p) => p.path === 'apps/rust-service');
    expect(rustPkg).toBeDefined();
    expect(rustPkg?.ecosystem).toBe('rust');
    expect(rustPkg?.supported).toBe(true);
  });

  test('respects .gitignore directory entries', async () => {
    mkdir('generated-code');
    touch('generated-code/package.json', JSON.stringify({ name: 'generated' }));
    mkdir('apps/server');
    touch('apps/server/package.json', JSON.stringify({ name: 'server' }));
    // Write a .gitignore that excludes generated-code
    touch('.gitignore', 'generated-code/\n');

    const packages = await scanRepo(tmpDir);
    expect(packages.some((p) => p.path.includes('generated-code'))).toBe(false);
    expect(packages.some((p) => p.path === 'apps/server')).toBe(true);
  });
});
