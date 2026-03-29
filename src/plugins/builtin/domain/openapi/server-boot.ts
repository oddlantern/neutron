import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { isRecord, getScripts } from "@/plugins/builtin/shared/exec";

/** Default timeout waiting for server to accept connections (ms) */
export const DEFAULT_STARTUP_TIMEOUT = 15_000;

/** How often to poll the server during startup (ms) */
const POLL_INTERVAL = 500;

/** Max time to wait for graceful shutdown before SIGKILL (ms) */
const KILL_TIMEOUT = 3_000;

/** Maximum bytes of child output to capture */
const MAX_OUTPUT_BYTES = 256 * 1024;

/** Maximum bytes of HTTP response body to consume from spec endpoint */
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

/** Find a free port by binding to port 0 and closing immediately */
export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a free port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/** Well-known entry files checked in order */
const ENTRY_CANDIDATES: readonly string[] = [
  "src/index.ts",
  "src/main.ts",
  "src/app.ts",
  "index.ts",
  "main.ts",
  "app.ts",
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
export async function detectEntryFile(packageDir: string): Promise<string | null> {
  try {
    const content = await readFile(join(packageDir, "package.json"), "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) {
      throw new Error("Expected object");
    }

    // Check main field
    const main = parsed["main"];
    if (typeof main === "string" && existsSync(join(packageDir, main))) {
      return main;
    }

    // Check dev and start scripts for file arguments
    const scripts = getScripts(parsed);
    for (const scriptName of ["dev", "start"]) {
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
export function killProcess(child: ChildProcess): Promise<void> {
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

    child.on("exit", cleanup);
    child.on("error", cleanup);

    child.kill("SIGTERM");

    setTimeout(() => {
      if (!resolved && child.pid) {
        try {
          child.kill("SIGKILL");
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
export async function waitForServer(port: number, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/`, {
        signal: controller.signal,
        redirect: "error",
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
export interface FetchAttempt {
  readonly path: string;
  readonly status: number | null;
  readonly error: string | null;
}

/**
 * Try fetching the spec from a list of paths.
 * Returns the parsed JSON and the path that worked, or null with attempt details.
 */
export async function fetchSpec(
  port: number,
  paths: readonly string[],
): Promise<
  | {
      readonly spec: Record<string, unknown>;
      readonly path: string;
      readonly attempts: readonly FetchAttempt[];
    }
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
        redirect: "error",
      });

      if (!response.ok) {
        attempts.push({ path: specPath, status: response.status, error: null });
        response.body?.cancel();
        continue;
      }

      // Guard against oversized responses
      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
        attempts.push({ path: specPath, status: response.status, error: "response too large" });
        response.body?.cancel();
        continue;
      }

      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        attempts.push({
          path: specPath,
          status: response.status,
          error: "response body too large",
        });
        continue;
      }

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        attempts.push({ path: specPath, status: response.status, error: "invalid JSON" });
        continue;
      }

      if (!isRecord(body)) {
        attempts.push({
          path: specPath,
          status: response.status,
          error: "response is not a JSON object",
        });
        continue;
      }

      // Validate it looks like an OpenAPI spec
      if (!("openapi" in body) && !("swagger" in body)) {
        attempts.push({
          path: specPath,
          status: response.status,
          error: "missing openapi/swagger key",
        });
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

/** Format fetch attempts into a readable diagnostic string */
export function formatAttempts(attempts: readonly FetchAttempt[]): string {
  if (attempts.length === 0) {
    return "";
  }
  return attempts
    .map((a) => {
      if (a.status) {
        return `  ${a.path} → ${String(a.status)}${a.error ? ` (${a.error})` : ""}`;
      }
      return `  ${a.path} → ${a.error ?? "unknown error"}`;
    })
    .join("\n");
}

/** Result of spawning a server process */
export interface SpawnedServer {
  readonly child: ChildProcess;
  readonly port: number;
  readonly exitHandler: () => void;
  readonly outputChunks: readonly string[];
  readonly earlyExitRef: { readonly earlyExit: boolean; readonly exitCode: number | null };
}

/**
 * Boot a server process on a free port.
 * Returns the child process, port, and associated cleanup handlers.
 */
export function spawnServer(
  packageDir: string,
  pm: string,
  entryFile: string,
  port: number,
  debug: ((msg: string) => void) | undefined,
): SpawnedServer {
  const runnerArgs = pm === "bun" ? ["run", entryFile] : ["tsx", entryFile];
  const runner = pm === "bun" ? "bun" : "npx";

  debug?.(`spawning: ${runner} ${runnerArgs.join(" ")} (cwd: ${packageDir})`);

  const child = spawn(runner, runnerArgs, {
    cwd: packageDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env["PATH"],
      HOME: process.env["HOME"],
      NODE_ENV: process.env["NODE_ENV"],
      PORT: String(port),
    },
  });

  // Safety net: kill child if parent exits unexpectedly
  const exitHandler = (): void => {
    try {
      child.kill("SIGKILL");
    } catch {
      // already dead
    }
  };
  process.on("exit", exitHandler);

  const outputChunks: string[] = [];
  let totalBytes = 0;
  const collectOutput = (data: Buffer): void => {
    if (totalBytes < MAX_OUTPUT_BYTES) {
      outputChunks.push(data.toString());
      totalBytes += data.length;
    }
  };

  child.stdout?.on("data", collectOutput);
  child.stderr?.on("data", collectOutput);

  // Handle early exit (e.g., syntax error, missing dependency)
  const earlyExitRef: { earlyExit: boolean; exitCode: number | null } = { earlyExit: false, exitCode: null };
  child.on("exit", (code) => {
    earlyExitRef.earlyExit = true;
    earlyExitRef.exitCode = code;
    debug?.(`server process exited with code ${String(code)}`);
  });

  return { child, port, exitHandler, outputChunks, earlyExitRef };
}
