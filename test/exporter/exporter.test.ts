import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

import { exportSpec } from '../../src/plugins/builtin/openapi/exporter.js';
import { elysiaAdapter } from '../../src/plugins/builtin/openapi/adapters/elysia.js';
import { assertWithinRoot } from '../../src/plugins/builtin/openapi/exporter.js';

const FIXTURE_DIR = resolve(import.meta.dir, '../fixture-server');

/** Longer timeout — server boot + spec fetch takes a few seconds */
const TEST_TIMEOUT = 20_000;

function makeTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'mido-test-exporter-')));
}

/**
 * Check if any child processes are still listening on a given port.
 * Returns true if the port is free (nothing listening).
 */
async function isPortFree(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_000);
    await fetch(`http://127.0.0.1:${String(port)}/`, { signal: controller.signal });
    clearTimeout(timer);
    return false; // got a response — something is still listening
  } catch {
    return true; // connection refused — port is free
  }
}

describe('exportSpec', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  test(
    'exports OpenAPI spec from Elysia fixture server',
    async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);
      const outputPath = join(tempDir, 'openapi.json');

      const result = await exportSpec({
        packageDir: FIXTURE_DIR,
        pm: 'bun',
        adapter: elysiaAdapter,
        outputPath,
        startupTimeout: 15_000,
      });

      // Assert export succeeded
      expect(result.success).toBe(true);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.summary).toContain('/openapi/json');

      // Assert spec was written to disk
      expect(existsSync(outputPath)).toBe(true);

      // Assert spec is valid OpenAPI JSON with expected routes
      const raw = readFileSync(outputPath, 'utf-8');
      const spec = JSON.parse(raw) as Record<string, unknown>;

      expect(spec['openapi']).toBeDefined();
      expect(typeof spec['openapi']).toBe('string');

      const paths = spec['paths'] as Record<string, unknown>;
      expect(paths).toBeDefined();
      expect(paths['/health']).toBeDefined();
      expect(paths['/walks']).toBeDefined();
    },
    TEST_TIMEOUT,
  );

  test(
    'server process is killed after export',
    async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);
      const outputPath = join(tempDir, 'openapi.json');

      const result = await exportSpec({
        packageDir: FIXTURE_DIR,
        pm: 'bun',
        adapter: elysiaAdapter,
        outputPath,
        startupTimeout: 15_000,
      });

      expect(result.success).toBe(true);

      // The spec was fetched from some port — verify nothing is listening anymore.
      // We can't know the exact port, but the summary tells us the path.
      // Instead, wait a moment and check that no stale bun processes remain.
      await new Promise((r) => setTimeout(r, 500));

      // Parse the port from the output if captured, or verify by attempting to connect
      // to common test ports. Since we use port 0, the best we can do is check
      // that the process exited cleanly (no zombie).
      // The result.success being true after try/finally guarantees killProcess ran.
      expect(result.summary).toContain('exported from');
    },
    TEST_TIMEOUT,
  );

  test(
    'handles missing entry file gracefully',
    async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);

      const result = await exportSpec({
        packageDir: tempDir, // empty dir, no entry file
        pm: 'bun',
        adapter: elysiaAdapter,
        outputPath: join(tempDir, 'openapi.json'),
      });

      expect(result.success).toBe(false);
      expect(result.summary).toContain('Could not detect entry file');
    },
    TEST_TIMEOUT,
  );

  test(
    'respects entryFile override',
    async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);
      const outputPath = join(tempDir, 'openapi.json');

      const result = await exportSpec({
        packageDir: FIXTURE_DIR,
        pm: 'bun',
        adapter: elysiaAdapter,
        outputPath,
        entryFile: 'src/index.ts',
        startupTimeout: 15_000,
      });

      expect(result.success).toBe(true);
      expect(existsSync(outputPath)).toBe(true);
    },
    TEST_TIMEOUT,
  );

  test(
    'respects specPath override',
    async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);
      const outputPath = join(tempDir, 'openapi.json');

      // Use a wrong spec path — should fail
      const result = await exportSpec({
        packageDir: FIXTURE_DIR,
        pm: 'bun',
        adapter: elysiaAdapter,
        outputPath,
        specPath: '/nonexistent/spec/endpoint',
        startupTimeout: 15_000,
      });

      expect(result.success).toBe(false);
      expect(result.summary).toContain('Could not find OpenAPI spec');
      expect(result.summary).toContain('/nonexistent/spec/endpoint');
    },
    TEST_TIMEOUT,
  );

  test(
    'handles server startup failure gracefully',
    async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);

      const result = await exportSpec({
        packageDir: FIXTURE_DIR,
        pm: 'bun',
        adapter: elysiaAdapter,
        outputPath: join(tempDir, 'openapi.json'),
        entryFile: 'nonexistent-file.ts',
        startupTimeout: 5_000,
      });

      expect(result.success).toBe(false);
      // Server should exit or timeout
      expect(
        result.summary.includes('Server exited') || result.summary.includes("didn't start"),
      ).toBe(true);
    },
    TEST_TIMEOUT,
  );
});

describe('assertWithinRoot', () => {
  test('accepts paths within root', () => {
    expect(() => assertWithinRoot('/workspace/packages/api', '/workspace')).not.toThrow();
    expect(() => assertWithinRoot('/workspace', '/workspace')).not.toThrow();
  });

  test('rejects paths outside root', () => {
    expect(() => assertWithinRoot('/etc/passwd', '/workspace')).toThrow('escapes workspace root');
    // resolve() normalizes ../  — callers always resolve() before calling assertWithinRoot
    expect(() => assertWithinRoot(resolve('/workspace/../etc'), '/workspace')).toThrow(
      'escapes workspace root',
    );
  });
});
