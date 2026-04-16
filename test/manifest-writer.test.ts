import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { applyManifestUpdate } from '../src/manifest-writer.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neutron-manifest-writer-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writePackageJson(relDir: string, content: Record<string, unknown>): string {
  const absDir = join(tmpDir, relDir);
  mkdirSync(absDir, { recursive: true });
  const filePath = join(absDir, 'package.json');
  writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n', 'utf-8');
  return filePath;
}

function writePubspec(relDir: string, content: string): string {
  const absDir = join(tmpDir, relDir);
  mkdirSync(absDir, { recursive: true });
  const filePath = join(absDir, 'pubspec.yaml');
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('applyManifestUpdate (package.json)', () => {
  test('updates dep in dependencies section', async () => {
    writePackageJson('packages/api', {
      name: '@test/api',
      dependencies: { zod: '^3.0.0', yaml: '^2.0.0' },
    });

    const updated = await applyManifestUpdate(tmpDir, {
      packagePath: 'packages/api',
      ecosystem: 'typescript',
      depName: 'zod',
      newRange: '^3.25.0',
    });

    expect(updated).toBe(true);

    const written = JSON.parse(readFileSync(join(tmpDir, 'packages/api/package.json'), 'utf-8'));
    expect(written.dependencies.zod).toBe('^3.25.0');
    // Other deps unchanged
    expect(written.dependencies.yaml).toBe('^2.0.0');
  });

  test('updates dep in devDependencies section', async () => {
    writePackageJson('packages/ui', {
      name: '@test/ui',
      devDependencies: { typescript: '^5.0.0' },
    });

    const updated = await applyManifestUpdate(tmpDir, {
      packagePath: 'packages/ui',
      ecosystem: 'typescript',
      depName: 'typescript',
      newRange: '^5.8.0',
    });

    expect(updated).toBe(true);

    const written = JSON.parse(readFileSync(join(tmpDir, 'packages/ui/package.json'), 'utf-8'));
    expect(written.devDependencies.typescript).toBe('^5.8.0');
  });

  test('returns false when dep is not found in any section', async () => {
    writePackageJson('packages/api', {
      name: '@test/api',
      dependencies: { zod: '^3.0.0' },
    });

    const updated = await applyManifestUpdate(tmpDir, {
      packagePath: 'packages/api',
      ecosystem: 'typescript',
      depName: 'nonexistent-package',
      newRange: '^1.0.0',
    });

    expect(updated).toBe(false);
  });

  test('preserves 2-space indentation', async () => {
    const pkgPath = join(tmpDir, 'packages/api');
    mkdirSync(pkgPath, { recursive: true });
    writeFileSync(
      join(pkgPath, 'package.json'),
      JSON.stringify({ name: '@test/api', dependencies: { zod: '^3.0.0' } }, null, 2) + '\n',
      'utf-8',
    );

    await applyManifestUpdate(tmpDir, {
      packagePath: 'packages/api',
      ecosystem: 'typescript',
      depName: 'zod',
      newRange: '^3.25.0',
    });

    const content = readFileSync(join(pkgPath, 'package.json'), 'utf-8');
    // 2-space indent: each nested line starts with exactly 2 spaces
    expect(content).toMatch(/^  "/m);
  });

  test('preserves 4-space indentation', async () => {
    const pkgPath = join(tmpDir, 'packages/api');
    mkdirSync(pkgPath, { recursive: true });
    writeFileSync(
      join(pkgPath, 'package.json'),
      JSON.stringify({ name: '@test/api', dependencies: { zod: '^3.0.0' } }, null, 4) + '\n',
      'utf-8',
    );

    await applyManifestUpdate(tmpDir, {
      packagePath: 'packages/api',
      ecosystem: 'typescript',
      depName: 'zod',
      newRange: '^3.25.0',
    });

    const content = readFileSync(join(pkgPath, 'package.json'), 'utf-8');
    expect(content).toMatch(/^    "/m);
  });
});

describe('applyManifestUpdate (pubspec.yaml)', () => {
  test('updates scalar dep in dependencies section', async () => {
    writePubspec(
      'apps/flutter',
      `name: flutter_app\nversion: 0.1.0\ndependencies:\n  dio: ^5.0.0\n  freezed_annotation: ^2.0.0\n`,
    );

    const updated = await applyManifestUpdate(tmpDir, {
      packagePath: 'apps/flutter',
      ecosystem: 'dart',
      depName: 'dio',
      newRange: '^5.8.0',
    });

    expect(updated).toBe(true);

    const content = readFileSync(join(tmpDir, 'apps/flutter/pubspec.yaml'), 'utf-8');
    expect(content).toContain('dio: ^5.8.0');
    // Other deps unchanged
    expect(content).toContain('freezed_annotation: ^2.0.0');
  });

  test('returns false when dep not found in pubspec', async () => {
    writePubspec(
      'apps/flutter',
      `name: flutter_app\nversion: 0.1.0\ndependencies:\n  dio: ^5.0.0\n`,
    );

    const updated = await applyManifestUpdate(tmpDir, {
      packagePath: 'apps/flutter',
      ecosystem: 'dart',
      depName: 'nonexistent',
      newRange: '^1.0.0',
    });

    expect(updated).toBe(false);
  });

  test('returns false for path/git/sdk dep (cannot update range)', async () => {
    writePubspec(
      'apps/flutter',
      `name: flutter_app\nversion: 0.1.0\ndependencies:\n  local_pkg:\n    path: ../local_pkg\n`,
    );

    const updated = await applyManifestUpdate(tmpDir, {
      packagePath: 'apps/flutter',
      ecosystem: 'dart',
      depName: 'local_pkg',
      newRange: '^1.0.0',
    });

    expect(updated).toBe(false);
  });
});
