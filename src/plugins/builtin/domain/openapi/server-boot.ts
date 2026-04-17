import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { resolvePythonTool } from "@/plugins/builtin/ecosystem/python/plugin";
import { isRecord, getScripts } from "@/plugins/builtin/shared/exec";

/** Default timeout waiting for server to accept connections (ms) */
export const DEFAULT_STARTUP_TIMEOUT = 15_000;

/**
 * Startup timeout for cargo-run-based servers. First-run compile+link
 * for an axum app is routinely 30-60s; incremental builds are far
 * faster, but the first export from a fresh clone needs the headroom.
 */
export const RUST_STARTUP_TIMEOUT = 120_000;

/**
 * Startup timeout for go-run-based servers. Go compile+link is fast
 * but still measurable on cold module caches — bump from the TS/Python
 * default without going full Rust-level.
 */
export const GO_STARTUP_TIMEOUT = 30_000;

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

/** Well-known entry files checked in order. TS, Python, Rust, Go. */
const ENTRY_CANDIDATES: readonly string[] = [
  "src/index.ts",
  "src/main.ts",
  "src/app.ts",
  "index.ts",
  "main.ts",
  "app.ts",
  "src/main.py",
  "src/app.py",
  "main.py",
  "app.py",
  "src/main.rs",
  "src/bin/main.rs",
  "src/bin/server.rs",
  "src/bin/api.rs",
  "main.go",
  "cmd/server/main.go",
  "cmd/api/main.go",
  "cmd/main/main.go",
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
 *
 * For Python packages, package.json won't exist — we fall straight
 * through to the well-known path list, which includes main.py/app.py.
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
    // manifest unreadable — could be a Python package
  }

  // Check well-known paths (covers both TS and Python conventions)
  for (const candidate of ENTRY_CANDIDATES) {
    if (existsSync(join(packageDir, candidate))) {
      return candidate;
    }
  }

  return null;
}

/**
 * Convert a Rust entry file path to `cargo run` arguments.
 *
 * "src/main.rs"            → []                      (default binary)
 * "src/bin/server.rs"      → ["--bin", "server"]     (named binary)
 * "src/bin/api.rs"         → ["--bin", "api"]
 *
 * Always runs in release mode — axum + utoipa in debug mode is
 * noticeably slower to start, which hurts the spec-export cold path
 * more than the extra compile time does.
 */
export function rustEntryToCargoArgs(entryFile: string): readonly string[] {
  const args = ["run", "--release"];
  // A file under src/bin/<name>.rs is a named binary; everything else
  // (src/main.rs or a user-declared default) runs without --bin.
  const binMatch = entryFile.match(/^src\/bin\/([^/]+)\.rs$/);
  if (binMatch?.[1]) {
    args.push("--bin", binMatch[1]);
  }
  return args;
}

/**
 * Convert a Python source path to a module path and app variable.
 * "main.py" → { module: "main", app: "app" }
 * "src/main.py" → { module: "src.main", app: "app" }
 * "main.py:myapp" → { module: "main", app: "myapp" }  (explicit override)
 */
export function pythonEntryToModule(entryFile: string): {
  readonly module: string;
  readonly app: string;
} {
  const colonIdx = entryFile.indexOf(":");
  const path = colonIdx >= 0 ? entryFile.slice(0, colonIdx) : entryFile;
  const app = colonIdx >= 0 ? entryFile.slice(colonIdx + 1) : "app";

  const withoutExt = path.endsWith(".py") ? path.slice(0, -3) : path;
  const module = withoutExt.replace(/\//g, ".");

  return { module, app };
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
 * Decide how to spawn the server based on the entry file's ecosystem.
 *
 * - Python entry files (`.py`) spawn via uvicorn from the venv chain.
 * - Rust entry files (`.rs`) spawn via `cargo run --release`.
 * - Everything else (TS/JS) goes through node/bun + tsx.
 *
 * The Rust path expects the server binary to read its port from the
 * PORT env var — spawnServer already propagates PORT. Servers that
 * hard-code a port will fail regardless; users can override via the
 * bridge's specPath once the server responds on its chosen port.
 */
function buildSpawnCommand(
  packageDir: string,
  pm: string,
  entryFile: string,
  port: number,
  root: string,
): { readonly runner: string; readonly args: readonly string[] } {
  // Python (FastAPI via uvicorn) — recognized by .py entry or explicit :app syntax.
  if (/\.py(?::|$)/.test(entryFile)) {
    const { module, app } = pythonEntryToModule(entryFile);
    const uvicorn = resolvePythonTool("uvicorn", packageDir, root);
    return {
      runner: uvicorn,
      args: [`${module}:${app}`, "--port", String(port)],
    };
  }

  // Rust (axum via cargo run).
  if (entryFile.endsWith(".rs")) {
    return {
      runner: "cargo",
      args: rustEntryToCargoArgs(entryFile),
    };
  }

  // Go (huma via go run).
  if (entryFile.endsWith(".go")) {
    return {
      runner: "go",
      // `go run <file>` works for single-file mains; `go run ./cmd/foo`
      // is the idiomatic form for module-based projects. Both accept
      // the path as-is.
      args: ["run", entryFile],
    };
  }

  // TypeScript / JavaScript — fall through to the existing runner pair.
  return {
    runner: pm === "bun" ? "bun" : "npx",
    args: pm === "bun" ? ["run", entryFile] : ["tsx", entryFile],
  };
}

/**
 * Boot a server process on a free port.
 * Returns the child process, port, and associated cleanup handlers.
 *
 * `root` is the workspace root — needed to resolve Python tools from a
 * workspace-level .venv when no package-level venv exists. For TS it's
 * a no-op.
 */
export function spawnServer(
  packageDir: string,
  pm: string,
  entryFile: string,
  port: number,
  debug: ((msg: string) => void) | undefined,
  root?: string,
): SpawnedServer {
  // If root wasn't provided (older callers), derive it from packageDir.
  // For relative resolution it doesn't matter — we only need it for
  // the Python tool chain, and if the caller is still on the TS path
  // this is never consulted.
  const resolvedRoot = root ?? packageDir;
  const { runner, args } = buildSpawnCommand(packageDir, pm, entryFile, port, resolvedRoot);

  debug?.(`spawning: ${runner} ${args.join(" ")} (cwd: ${packageDir})`);

  const child = spawn(runner, args, {
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
  const earlyExitRef: { earlyExit: boolean; exitCode: number | null } = {
    earlyExit: false,
    exitCode: null,
  };
  child.on("exit", (code) => {
    earlyExitRef.earlyExit = true;
    earlyExitRef.exitCode = code;
    debug?.(`server process exited with code ${String(code)}`);
  });

  return { child, port, exitHandler, outputChunks, earlyExitRef };
}
