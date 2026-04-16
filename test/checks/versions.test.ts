import { describe, expect, test } from 'bun:test';

import type { WorkspaceGraph } from '../../src/graph/types.js';
import type { NeutronLock } from '../../src/lock.js';
import { checkVersionConsistency } from '../../src/checks/versions.js';

function makeLockEntry(range: string): { readonly range: string; readonly integrity: string; readonly ecosystems: readonly string[]; readonly resolvedAt: string } {
  const { createHash } = require('node:crypto');
  const hash = createHash('sha256').update(range).digest('hex').slice(0, 16);
  return { range, integrity: `sha256-${hash}`, ecosystems: ['typescript'], resolvedAt: '2026-03-26T00:00:00.000Z' };
}

function makeLock(entries: Record<string, string>): NeutronLock {
  const resolved: Record<string, ReturnType<typeof makeLockEntry>> = {};
  for (const [name, range] of Object.entries(entries)) {
    resolved[name] = makeLockEntry(range);
  }
  return { version: 2, resolved };
}

function makeGraph(
  packages: Array<{
    name: string;
    path: string;
    deps: Array<{ name: string; range: string }>;
  }>,
  root = '/workspace',
): WorkspaceGraph {
  const pkgMap = new Map(
    packages.map((p) => [
      p.path,
      {
        name: p.name,
        path: p.path,
        ecosystem: 'typescript',
        version: undefined,
        dependencies: p.deps.map((d) => ({ name: d.name, range: d.range, type: 'production' as const })),
        localDependencies: [],
      },
    ]),
  );

  return {
    name: 'test-workspace',
    root,
    packages: pkgMap,
    bridges: [],
  };
}

describe('checkVersionConsistency', () => {
  test('single-occurrence dep produces no issues', () => {
    const graph = makeGraph([
      { name: 'pkg-a', path: 'packages/a', deps: [{ name: 'zod', range: '^3.0.0' }] },
    ]);
    const result = checkVersionConsistency(graph, null);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('same range across multiple packages produces no issues', () => {
    const graph = makeGraph([
      { name: 'pkg-a', path: 'packages/a', deps: [{ name: 'zod', range: '^3.0.0' }] },
      { name: 'pkg-b', path: 'packages/b', deps: [{ name: 'zod', range: '^3.0.0' }] },
    ]);
    const result = checkVersionConsistency(graph, null);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('differing ranges without lock produces error', () => {
    const graph = makeGraph([
      { name: 'pkg-a', path: 'packages/a', deps: [{ name: 'zod', range: '^3.0.0' }] },
      { name: 'pkg-b', path: 'packages/b', deps: [{ name: 'zod', range: '^2.0.0' }] },
    ]);
    const result = checkVersionConsistency(graph, null);
    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.severity).toBe('error');
    expect(result.issues[0]?.message).toContain('zod');
    expect(result.issues[0]?.message).toContain('2 different version ranges');
  });

  test('matching locked range produces no issues', () => {
    const graph = makeGraph([
      { name: 'pkg-a', path: 'packages/a', deps: [{ name: 'zod', range: '^3.0.0' }] },
      { name: 'pkg-b', path: 'packages/b', deps: [{ name: 'zod', range: '^3.0.0' }] },
    ]);
    const lock = makeLock({ zod: '^3.0.0' });
    const result = checkVersionConsistency(graph, lock);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('deviating from locked range produces error', () => {
    const graph = makeGraph([
      { name: 'pkg-a', path: 'packages/a', deps: [{ name: 'zod', range: '^3.0.0' }] },
      { name: 'pkg-b', path: 'packages/b', deps: [{ name: 'zod', range: '^2.0.0' }] },
    ]);
    const lock = makeLock({ zod: '^3.0.0' });
    const result = checkVersionConsistency(graph, lock);
    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain('locked range');
    expect(result.issues[0]?.message).toContain('^3.0.0');
  });

  test('local deps (range <local>) are skipped', () => {
    const graph = makeGraph([
      { name: 'pkg-a', path: 'packages/a', deps: [{ name: 'pkg-b', range: '<local>' }] },
      { name: 'pkg-b', path: 'packages/b', deps: [{ name: 'pkg-a', range: '<local>' }] },
    ]);
    const result = checkVersionConsistency(graph, null);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('summary reflects no issues when all consistent', () => {
    const graph = makeGraph([
      { name: 'pkg-a', path: 'packages/a', deps: [{ name: 'zod', range: '^3.0.0' }] },
      { name: 'pkg-b', path: 'packages/b', deps: [{ name: 'zod', range: '^3.0.0' }] },
    ]);
    const result = checkVersionConsistency(graph, null);
    expect(result.summary).toContain('consistent');
  });

  test('summary reflects mismatch count when issues found', () => {
    const graph = makeGraph([
      { name: 'pkg-a', path: 'packages/a', deps: [{ name: 'zod', range: '^3.0.0' }] },
      { name: 'pkg-b', path: 'packages/b', deps: [{ name: 'zod', range: '^2.0.0' }] },
    ]);
    const result = checkVersionConsistency(graph, null);
    expect(result.summary).toContain('mismatch');
  });
});
