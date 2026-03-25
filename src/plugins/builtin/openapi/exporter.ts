import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { FrameworkAdapter } from './adapters/types.js';
import type { ExecuteResult } from '../../types.js';
import { isRecord, getScripts, readPackageJson } from '../exec.js';

/** Default timeout waiting for server to accept connections (ms) */
const DEFAULT_STARTUP_TIMEOUT = 15_000;

/** How often to poll the server during startup (ms) */
const POLL_INTERVAL = 500;

/** Max time to wait for graceful shutdown before SIGKILL (ms) */
const KILL_TIMEOUT = 3_000;

/** Maximum bytes of child output to capture */
const MAX_OUTPUT_BYTES = 256 * 1024;

/** Maximum bytes of HTTP response body to consume from spec endpoint */
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

/**
 * Assert that a resolved path stays within the workspace root.
 * Prevents path traversal via malicious config values.
 */
export function assertWithinRoot(resolved: string, root: string): void {
  // Normalize both to ensure trailing slashes don't cause mismatches
  const normalizedRoot = root.endsWith('/') ? root : `${root}/`;
  const normalizedResolved = resolved.endsWith('/') ? resolved : `${resolved}/`;
  if (!normalizedResolved.startsWith(normalizedRoot) && resolved !== root) {
    throw new Error(`Path "${resolved}" escapes workspace root "${root}"`);
  }
}

export interface ExportOptions {
  /** Absolute path to the server package */
  readonly packageDir: string;
  /** Package manager to use */
  readonly pm: string;
  /** Framework adapter with endpoint info */
  readonly adapter: FrameworkAdapter;
  /** Absolute path where the spec should be written */
  readonly outputPath: string;
  /** How long to wait for server to start (ms) */
  readonly startupTimeout?: number | undefined;
  /** Entry file relative to packageDir (overrides auto-detection) */
  readonly entryFile?: string | undefined;
  /** Spec endpoint path (overrides adapter default) */
  readonly specPath?: string | undefined;
  /** Enable verbose debug logging */
  readonly verbose?: boolean | undefined;
}

/** Find a free port by binding to port 0 and closing immediately */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a free port'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/** Well-known entry files checked in order */
const ENTRY_CANDIDATES: readonly string[] = [
  'src/index.ts',
  'src/main.ts',
  'src/app.ts',
  'index.ts',
  'main.ts',
  'app.ts',
];

/**
 * Parse an entry file from a script value.
 * Handles patterns like: "bun run --watch src/index.ts", "tsx src/index.ts",
 * "node dist/index.js", "ts-node src/main.ts"
 */
function parseEntryFromScript(script: string): string | null {
  // Match common patterns: runner [flags...] <file.ts|file.js>
  const match = /(?:^|\s)(\S+\.(?:ts|js|mjs|mts))(?:\s|$)/.exec(script);
  return match?.[1] ?? null;
}

/**
 * Auto-detect the server entry file from an absolute package directory.
 * Priority: main field → dev script → start script → well-known paths.
 */
async function detectEntryFile(packageDir: string): Promise<string | null> {
  try {
    const content = await readFile(join(packageDir, 'package.json'), 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) {
      throw new Error('Expected object');
    }

    // Check main field
    const main = parsed['main'];
    if (typeof main === 'string' && existsSync(join(packageDir, main))) {
      return main;
    }

    // Check dev and start scripts for file arguments
    const scripts = getScripts(parsed);
    for (const scriptName of ['dev', 'start']) {
      const script = scripts[scriptName];
      if (!script) {
        continue;
      }
      const entry = parseEntryFromScript(script);
      if (entry && existsSync(join(packageDir, entry))) {
        return entry;
      }
    }
  } catch {
    // manifest unreadable
  }

  // Check well-known paths
  for (const candidate of ENTRY_CANDIDATES) {
    if (existsSync(join(packageDir, candidate))) {
      return candidate;
    }
  }

  return null;
}

/** Kill a child process gracefully, then forcefully if needed */
function killProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!child.pid) {
      resolve();
      return;
    }

    let resolved = false;
    const cleanup = (): void => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    child.on('exit', cleanup);
    child.on('error', cleanup);

    child.kill('SIGTERM');

    setTimeout(() => {
      if (!resolved && child.pid) {
        try {
          child.kill('SIGKILL');
        } catch {
          // already dead
        }
      }
      cleanup();
    }, KILL_TIMEOUT);
  });
}

/**
 * Poll until the server responds on the given port.
 * Returns true if the server started, false on timeout.
 */
async function waitForServer(port: number, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/`, {
        signal: controller.signal,
        redirect: 'error',
      });
      // Any response means the server is up — we don't care about the status
      response.body?.cancel();
      return true;
    } catch {
      // Not ready yet
    } finally {
      clearTimeout(timer);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  return false;
}

/** Per-path fetch attempt result for diagnostics */
interface FetchAttempt {
  readonly path: string;
  readonly status: number | null;
  readonly error: string | null;
}

/**
 * Try fetching the spec from a list of paths.
 * Returns the parsed JSON and the path that worked, or null with attempt details.
 */
async function fetchSpec(
  port: number,
  paths: readonly string[],
): Promise<
  | { readonly spec: Record<string, unknown>; readonly path: string; readonly attempts: readonly FetchAttempt[] }
  | { readonly spec: null; readonly path: null; readonly attempts: readonly FetchAttempt[] }
> {
  const attempts: FetchAttempt[] = [];

  for (const specPath of paths) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const url = `http://127.0.0.1:${String(port)}${specPath}`;
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'error',
      });

      if (!response.ok) {
        attempts.push({ path: specPath, status: response.status, error: null });
        response.body?.cancel();
        continue;
      }

      // Guard against oversized responses
      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
        attempts.push({ path: specPath, status: response.status, error: 'response too large' });
        response.body?.cancel();
        continue;
      }

      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        attempts.push({ path: specPath, status: response.status, error: 'response body too large' });
        continue;
      }

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        attempts.push({ path: specPath, status: response.status, error: 'invalid JSON' });
        continue;
      }

      if (!isRecord(body)) {
        attempts.push({ path: specPath, status: response.status, error: 'response is not a JSON object' });
        continue;
      }

      // Validate it looks like an OpenAPI spec
      if (!('openapi' in body) && !('swagger' in body)) {
        attempts.push({ path: specPath, status: response.status, error: 'missing openapi/swagger key' });
        continue;
      }

      return { spec: body, path: specPath, attempts };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      attempts.push({ path: specPath, status: null, error: msg });
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  return { spec: null, path: null, attempts };
}

/**
 * Export an OpenAPI spec by booting the server, fetching the spec endpoint,
 * writing it to disk, and killing the server.
 */
/** Format fetch attempts into a readable diagnostic string */
function formatAttempts(attempts: readonly FetchAttempt[]): string {
  if (attempts.length === 0) {
    return '';
  }
  return attempts
    .map((a) => {
      if (a.status) {
        return `  ${a.path} → ${String(a.status)}${a.error ? ` (${a.error})` : ''}`;
      }
      return `  ${a.path} → ${a.error ?? 'unknown error'}`;
    })
    .join('\n');
}

export async function exportSpec(options: ExportOptions): Promise<ExecuteResult> {
  const {
    packageDir,
    pm,
    adapter,
    outputPath,
    startupTimeout = DEFAULT_STARTUP_TIMEOUT,
    verbose = false,
  } = options;
  const start = performance.now();
  const debug = verbose ? (msg: string): void => console.error(`  [exporter] ${msg}`) : undefined;

  // 1. Resolve entry file
  const entryFile = options.entryFile ?? (await detectEntryFile(packageDir));
  debug?.(`entry file: ${entryFile ?? 'not found'}`);
  if (!entryFile) {
    return {
      success: false,
      duration: Math.round(performance.now() - start),
      summary: `Could not detect entry file in ${packageDir}. Set entryFile on the bridge.`,
    };
  }

  // 2. Find a free port
  let port: number;
  try {
    port = await findFreePort();
    debug?.(`allocated port ${String(port)}`);
  } catch {
    return {
      success: false,
      duration: Math.round(performance.now() - start),
      summary: 'Port allocation failed. Check if another mido dev instance is running.',
    };
  }

  // 3. Boot the server
  const runnerArgs = pm === 'bun'
    ? ['run', entryFile]
    : ['tsx', entryFile];
  const runner = pm === 'bun' ? 'bun' : 'npx';

  debug?.(`spawning: ${runner} ${runnerArgs.join(' ')} (cwd: ${packageDir})`);

  const child = spawn(runner, runnerArgs, {
    cwd: packageDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) },
  });

  // Safety net: kill child if parent exits unexpectedly
  const exitHandler = (): void => {
    try {
      child.kill('SIGKILL');
    } catch {
      // already dead
    }
  };
  process.on('exit', exitHandler);

  const outputChunks: string[] = [];
  let totalBytes = 0;
  const collectOutput = (data: Buffer): void => {
    if (totalBytes < MAX_OUTPUT_BYTES) {
      outputChunks.push(data.toString());
      totalBytes += data.length;
    }
  };

  child.stdout?.on('data', collectOutput);
  child.stderr?.on('data', collectOutput);

  // Handle early exit (e.g., syntax error, missing dependency)
  let earlyExit = false;
  let exitCode: number | null = null;
  child.on('exit', (code) => {
    earlyExit = true;
    exitCode = code;
    debug?.(`server process exited with code ${String(code)}`);
  });

  try {
    // 4. Wait for server to be ready
    debug?.(`polling http://127.0.0.1:${String(port)}/ (timeout: ${String(startupTimeout)}ms)`);
    const ready = await waitForServer(port, startupTimeout);
    debug?.(`server ready: ${String(ready)}, earlyExit: ${String(earlyExit)}`);

    if (!ready) {
      const serverOutput = outputChunks.join('');
      const timeoutSec = Math.round(startupTimeout / 1000);
      const reason = earlyExit
        ? `Server exited with code ${String(exitCode)} before becoming ready`
        : `Server didn't start within ${String(timeoutSec)}s`;
      return {
        success: false,
        duration: Math.round(performance.now() - start),
        summary: `${reason}. Entry: ${entryFile}`,
        output: serverOutput || undefined,
      };
    }
    // Server responded — from here, success depends only on fetching and writing
    // the spec, not on the server process staying alive.

    // 5. Fetch the spec
    const specPathOverride = options.specPath;
    // Ensure spec paths start with / to prevent URL construction issues
    const normalize = (p: string): string => (p.startsWith('/') ? p : `/${p}`);
    const pathsToTry = specPathOverride
      ? [normalize(specPathOverride)]
      : [adapter.defaultSpecPath, ...adapter.fallbackSpecPaths];

    debug?.(`fetching spec from: ${pathsToTry.join(', ')}`);
    const result = await fetchSpec(port, pathsToTry);
    debug?.(`fetch result: ${result.spec ? `found at ${result.path}` : 'not found'}`);

    if (!result.spec) {
      const serverOutput = outputChunks.join('');
      const attemptDetails = formatAttempts(result.attempts);
      const details = [
        attemptDetails ? `Endpoints tried:\n${attemptDetails}` : '',
        serverOutput ? `Server output:\n${serverOutput.trim().split('\n').slice(0, 10).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      return {
        success: false,
        duration: Math.round(performance.now() - start),
        summary: 'Could not find OpenAPI spec. Add an openapi:export script as fallback.',
        output: details || undefined,
      };
    }

    // 6. Write spec to disk
    debug?.(`writing spec to ${outputPath}`);
    try {
      const outputDir = dirname(outputPath);
      if (!existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
      }
      await writeFile(outputPath, JSON.stringify(result.spec, null, 2) + '\n', 'utf-8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        duration: Math.round(performance.now() - start),
        summary: `Failed to write spec: ${msg}`,
      };
    }

    debug?.(`export complete`);
    return {
      success: true,
      duration: Math.round(performance.now() - start),
      summary: `exported from ${result.path}`,
    };
  } finally {
    // Always kill the server and remove the exit handler
    debug?.(`killing server process`);
    await killProcess(child);
    process.removeListener('exit', exitHandler);
  }
}

/**
 * Detect a framework adapter for a package.
 * Reads the package.json and checks all adapters.
 */
export async function detectFrameworkAdapter(
  pkgPath: string,
  root: string,
): Promise<FrameworkAdapter | null> {
  const { detectAdapter } = await import('./adapters/index.js');

  try {
    const manifest = await readPackageJson(pkgPath, root);
    const allDeps: Record<string, string> = {};

    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const deps = manifest[field];
      if (isRecord(deps)) {
        for (const [name, version] of Object.entries(deps)) {
          if (typeof version === 'string') {
            allDeps[name] = version;
          }
        }
      }
    }

    return detectAdapter(allDeps);
  } catch {
    return null;
  }
}
