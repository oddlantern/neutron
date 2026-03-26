import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { WorkspaceGraph } from '../../src/graph/types.js';
import { checkBridges } from '../../src/checks/bridges.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mido-bridges-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makePackage(name: string, path: string, ecosystem = 'typescript') {
  return {
    name,
    path,
    ecosystem,
    version: undefined,
    dependencies: [],
    localDependencies: [],
  };
}

function makeGraph(
  packages: Array<ReturnType<typeof makePackage>>,
  bridges: Array<{ source: string; target: string; artifact: string }>,
  root: string,
): WorkspaceGraph {
  return {
    name: 'test-workspace',
    root,
    packages: new Map(packages.map((p) => [p.path, p])),
    bridges: bridges.map((b) => ({
      source: b.source,
      target: b.target,
      artifact: b.artifact,
      run: undefined,
      watch: undefined,
      entryFile: undefined,
      specPath: undefined,
    })),
  };
}

describe('checkBridges', () => {
  test('valid bridge passes with no issues', () => {
    // Create the artifact file
    writeFileSync(join(tmpDir, 'openapi.json'), '{}');

    const graph = makeGraph(
      [
        makePackage('server', 'apps/server', 'typescript'),
        makePackage('client', 'packages/client', 'dart'),
      ],
      [{ source: 'apps/server', target: 'packages/client', artifact: 'openapi.json' }],
      tmpDir,
    );

    const result = checkBridges(graph);
    expect(result.passed).toBe(true);
    // Cross-ecosystem bridge — no warnings expected
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  test('missing source package produces error', () => {
    writeFileSync(join(tmpDir, 'openapi.json'), '{}');

    const graph = makeGraph(
      [makePackage('client', 'packages/client', 'dart')],
      [{ source: 'apps/server', target: 'packages/client', artifact: 'openapi.json' }],
      tmpDir,
    );

    const result = checkBridges(graph);
    expect(result.passed).toBe(false);
    const sourceIssue = result.issues.find(
      (i) => i.severity === 'error' && i.message.includes('source'),
    );
    expect(sourceIssue).toBeDefined();
    expect(sourceIssue?.message).toContain('apps/server');
  });

  test('missing target package produces error', () => {
    writeFileSync(join(tmpDir, 'openapi.json'), '{}');

    const graph = makeGraph(
      [makePackage('server', 'apps/server', 'typescript')],
      [{ source: 'apps/server', target: 'packages/client', artifact: 'openapi.json' }],
      tmpDir,
    );

    const result = checkBridges(graph);
    expect(result.passed).toBe(false);
    const targetIssue = result.issues.find(
      (i) => i.severity === 'error' && i.message.includes('target'),
    );
    expect(targetIssue).toBeDefined();
    expect(targetIssue?.message).toContain('packages/client');
  });

  test('missing artifact file produces error', () => {
    // Do NOT create the artifact file
    const graph = makeGraph(
      [
        makePackage('server', 'apps/server', 'typescript'),
        makePackage('client', 'packages/client', 'dart'),
      ],
      [{ source: 'apps/server', target: 'packages/client', artifact: 'openapi.json' }],
      tmpDir,
    );

    const result = checkBridges(graph);
    expect(result.passed).toBe(false);
    const artifactIssue = result.issues.find(
      (i) => i.severity === 'error' && i.message.includes('artifact'),
    );
    expect(artifactIssue).toBeDefined();
    expect(artifactIssue?.message).toContain('openapi.json');
  });

  test('same-ecosystem bridge produces warning but still passes', () => {
    writeFileSync(join(tmpDir, 'shared.json'), '{}');

    const graph = makeGraph(
      [
        makePackage('pkg-a', 'packages/a', 'typescript'),
        makePackage('pkg-b', 'packages/b', 'typescript'),
      ],
      [{ source: 'packages/a', target: 'packages/b', artifact: 'shared.json' }],
      tmpDir,
    );

    const result = checkBridges(graph);
    // No errors (artifact exists, packages exist) — but may have warning
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
    const warnings = result.issues.filter((i) => i.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('same ecosystem');
    expect(result.passed).toBe(true);
  });

  test('no bridges produces passing result', () => {
    const graph = makeGraph([], [], tmpDir);
    const result = checkBridges(graph);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});
