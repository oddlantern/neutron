import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { pubspecParser } from '../../src/parsers/pubspec.js';

function makeTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'mido-test-pubspec-')));
}

function writePubspec(dir: string, content: string): string {
  const path = join(dir, 'pubspec.yaml');
  writeFileSync(path, content);
  return path;
}

describe('pubspecParser', () => {
  test('manifestName is pubspec.yaml', () => {
    expect(pubspecParser.manifestName).toBe('pubspec.yaml');
  });

  test('parses valid pubspec.yaml with name and version', async () => {
    const dir = makeTempDir();
    const path = writePubspec(
      dir,
      `
name: my_flutter_app
version: 1.0.0
dependencies:
  flutter:
    sdk: flutter
`,
    );

    const result = await pubspecParser.parse(path);

    expect(result.name).toBe('my_flutter_app');
    expect(result.version).toBe('1.0.0');
  });

  test('extracts dependencies and dev_dependencies', async () => {
    const dir = makeTempDir();
    const path = writePubspec(
      dir,
      `
name: test_pkg
version: 0.1.0
dependencies:
  http: ^1.2.0
  provider: ^6.0.0
dev_dependencies:
  build_runner: ^2.4.0
`,
    );

    const result = await pubspecParser.parse(path);

    const names = result.dependencies.map((d) => d.name);
    expect(names).toContain('http');
    expect(names).toContain('provider');
    expect(names).toContain('build_runner');

    const http = result.dependencies.find((d) => d.name === 'http');
    const buildRunner = result.dependencies.find((d) => d.name === 'build_runner');

    expect(http!.type).toBe('production');
    expect(buildRunner!.type).toBe('dev');
  });

  test('detects path dependencies as local', async () => {
    const dir = makeTempDir();
    const path = writePubspec(
      dir,
      `
name: consumer
dependencies:
  shared_models:
    path: ../shared
`,
    );

    const result = await pubspecParser.parse(path);

    const shared = result.dependencies.find((d) => d.name === 'shared_models');
    expect(shared).toBeDefined();
    expect(shared!.range).toBe('<local>');

    // Also check localDependencyPaths
    expect(result.localDependencyPaths).toHaveLength(1);
    expect(result.localDependencyPaths[0]).toContain('shared');
  });

  test('handles missing version', async () => {
    const dir = makeTempDir();
    const path = writePubspec(
      dir,
      `
name: no_version_pkg
dependencies:
  http: ^1.0.0
`,
    );

    const result = await pubspecParser.parse(path);

    expect(result.name).toBe('no_version_pkg');
    expect(result.version).toBeUndefined();
  });

  test('handles sdk dependencies', async () => {
    const dir = makeTempDir();
    const path = writePubspec(
      dir,
      `
name: sdk_test
dependencies:
  flutter:
    sdk: flutter
`,
    );

    const result = await pubspecParser.parse(path);

    const flutter = result.dependencies.find((d) => d.name === 'flutter');
    expect(flutter).toBeDefined();
    expect(flutter!.range).toBe('<local>');
  });

  test('handles null version constraint (any)', async () => {
    const dir = makeTempDir();
    const path = writePubspec(
      dir,
      `
name: any_dep
dependencies:
  some_pkg:
`,
    );

    const result = await pubspecParser.parse(path);

    const dep = result.dependencies.find((d) => d.name === 'some_pkg');
    expect(dep).toBeDefined();
    expect(dep!.range).toBe('any');
  });
});
