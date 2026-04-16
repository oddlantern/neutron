import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { resolveFiles } from '../../src/files/resolver.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neutron-resolver-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function touch(filePath: string): void {
  const absFile = join(tmpDir, filePath);
  const absDir = join(absFile, '..');
  mkdirSync(absDir, { recursive: true });
  writeFileSync(absFile, '');
}

function mkdirIn(dirPath: string): void {
  mkdirSync(join(tmpDir, dirPath), { recursive: true });
}

describe('resolveFiles', () => {
  test('returns matching .ts files', () => {
    touch('src/index.ts');
    touch('src/utils.ts');
    touch('src/readme.md');

    const files = resolveFiles(tmpDir, ['.ts'], []);
    expect(files).toContain('src/index.ts');
    expect(files).toContain('src/utils.ts');
    expect(files).not.toContain('src/readme.md');
  });

  test('excludes node_modules directory', () => {
    touch('src/index.ts');
    mkdirIn('node_modules/some-dep');
    writeFileSync(join(tmpDir, 'node_modules/some-dep/index.ts'), '');

    const files = resolveFiles(tmpDir, ['.ts'], []);
    expect(files).toContain('src/index.ts');
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
  });

  test('excludes dist directory', () => {
    touch('src/index.ts');
    mkdirIn('dist');
    writeFileSync(join(tmpDir, 'dist/bundle.ts'), '');

    const files = resolveFiles(tmpDir, ['.ts'], []);
    expect(files).toContain('src/index.ts');
    expect(files.some((f) => f.startsWith('dist'))).toBe(false);
  });

  test('excludes .git directory', () => {
    touch('src/index.ts');
    mkdirIn('.git/hooks');
    writeFileSync(join(tmpDir, '.git/hooks/pre-commit.ts'), '');

    const files = resolveFiles(tmpDir, ['.ts'], []);
    expect(files).toContain('src/index.ts');
    expect(files.some((f) => f.includes('.git'))).toBe(false);
  });

  test('glob pattern *.g.dart excludes matching files', () => {
    touch('lib/api.dart');
    touch('lib/api.g.dart');
    touch('lib/models/user.dart');
    touch('lib/models/user.g.dart');

    const files = resolveFiles(tmpDir, ['.dart'], ['*.g.dart']);
    expect(files).toContain('lib/api.dart');
    expect(files).toContain('lib/models/user.dart');
    expect(files).not.toContain('lib/api.g.dart');
    expect(files).not.toContain('lib/models/user.g.dart');
  });

  test('bare directory name excludes that directory', () => {
    touch('src/index.ts');
    touch('generated/api.ts');
    touch('generated/types.ts');

    const files = resolveFiles(tmpDir, ['.ts'], ['generated']);
    expect(files).toContain('src/index.ts');
    expect(files.some((f) => f.startsWith('generated'))).toBe(false);
  });

  test('directory/** pattern excludes that directory tree', () => {
    touch('src/index.ts');
    touch('src/codegen/api.ts');
    touch('src/codegen/types.ts');

    const files = resolveFiles(tmpDir, ['.ts'], ['src/codegen/**']);
    expect(files).toContain('src/index.ts');
    expect(files.some((f) => f.includes('codegen'))).toBe(false);
  });

  test('multiple extensions are all included', () => {
    touch('src/component.ts');
    touch('src/component.tsx');
    touch('src/styles.css');

    const files = resolveFiles(tmpDir, ['.ts', '.tsx'], []);
    expect(files).toContain('src/component.ts');
    expect(files).toContain('src/component.tsx');
    expect(files).not.toContain('src/styles.css');
  });

  test('empty directory returns empty array', () => {
    const files = resolveFiles(tmpDir, ['.ts'], []);
    expect(files).toHaveLength(0);
  });

  test('exact path ignore pattern excludes specific file', () => {
    touch('src/index.ts');
    touch('src/generated/api.d.ts');

    const files = resolveFiles(tmpDir, ['.ts'], ['src/generated/api.d.ts']);
    expect(files).toContain('src/index.ts');
    expect(files).not.toContain('src/generated/api.d.ts');
  });
});
