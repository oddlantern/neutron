import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { FrameworkAdapter } from "./adapters/types.js";
import type { ExecuteResult } from "../../types.js";
import { isRecord, readPackageJson } from "../exec.js";
import {
  DEFAULT_STARTUP_TIMEOUT,
  detectEntryFile,
  fetchSpec,
  findFreePort,
  formatAttempts,
  killProcess,
  spawnServer,
  waitForServer,
} from "./server-boot.js";

/**
 * Assert that a resolved path stays within the workspace root.
 * Prevents path traversal via malicious config values.
 */
export function assertWithinRoot(filePath: string, root: string): void {
  const resolved = resolve(filePath);
  const resolvedRoot = resolve(root);
  const normalizedRoot = resolvedRoot.endsWith("/") ? resolvedRoot : `${resolvedRoot}/`;
  const normalizedResolved = resolved.endsWith("/") ? resolved : `${resolved}/`;
  if (!normalizedResolved.startsWith(normalizedRoot) && resolved !== resolvedRoot) {
    throw new Error(`Path "${filePath}" escapes workspace root "${root}"`);
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

/**
 * Export an OpenAPI spec by booting the server, fetching the spec endpoint,
 * writing it to disk, and killing the server.
 */
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
  debug?.(`entry file: ${entryFile ?? "not found"}`);
  if (entryFile) {
    assertWithinRoot(join(packageDir, entryFile), packageDir);
  }
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
      summary: "Port allocation failed. Check if another mido dev instance is running.",
    };
  }

  // 3. Boot the server
  const server = spawnServer(packageDir, pm, entryFile, port, debug);

  try {
    // 4. Wait for server to be ready
    debug?.(`polling http://127.0.0.1:${String(port)}/ (timeout: ${String(startupTimeout)}ms)`);
    const ready = await waitForServer(port, startupTimeout);
    debug?.(`server ready: ${String(ready)}, earlyExit: ${String(server.earlyExitRef.earlyExit)}`);

    if (!ready) {
      const serverOutput = server.outputChunks.join("");
      const timeoutSec = Math.round(startupTimeout / 1000);
      const reason = server.earlyExitRef.earlyExit
        ? `Server exited with code ${String(server.earlyExitRef.exitCode)} before becoming ready`
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
    const normalize = (p: string): string => (p.startsWith("/") ? p : `/${p}`);
    const pathsToTry = specPathOverride
      ? [normalize(specPathOverride)]
      : [adapter.defaultSpecPath, ...adapter.fallbackSpecPaths];

    debug?.(`fetching spec from: ${pathsToTry.join(", ")}`);
    const result = await fetchSpec(port, pathsToTry);
    debug?.(`fetch result: ${result.spec ? `found at ${result.path}` : "not found"}`);

    if (!result.spec) {
      const serverOutput = server.outputChunks.join("");
      const attemptDetails = formatAttempts(result.attempts);
      const details = [
        attemptDetails ? `Endpoints tried:\n${attemptDetails}` : "",
        serverOutput
          ? `Server output:\n${serverOutput.trim().split("\n").slice(0, 10).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      return {
        success: false,
        duration: Math.round(performance.now() - start),
        summary: "Could not find OpenAPI spec. Add an openapi:export script as fallback.",
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
      await writeFile(outputPath, JSON.stringify(result.spec, null, 2) + "\n", "utf-8");
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
    await killProcess(server.child);
    process.removeListener("exit", server.exitHandler);
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
  const { detectAdapter } = await import("./adapters/index.js");

  try {
    const manifest = await readPackageJson(pkgPath, root);
    const allDeps: Record<string, string> = {};

    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const deps = manifest[field];
      if (isRecord(deps)) {
        for (const [name, version] of Object.entries(deps)) {
          if (typeof version === "string") {
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
