import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { parse as parseToml } from "smol-toml";

import type { FrameworkAdapter } from "@/plugins/builtin/domain/openapi/adapters/types";
import type { ExecuteResult } from "@/plugins/types";
import { isRecord, readPackageJson } from "@/plugins/builtin/shared/exec";
import {
  DEFAULT_STARTUP_TIMEOUT,
  GO_STARTUP_TIMEOUT,
  RUST_STARTUP_TIMEOUT,
  detectEntryFile,
  fetchSpec,
  findFreePort,
  formatAttempts,
  killProcess,
  spawnServer,
  waitForServer,
} from "@/plugins/builtin/domain/openapi/server-boot";

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
  /**
   * Absolute path to the workspace root. Used by Python server boot
   * to fall back to a workspace-level `.venv/bin/` when the package
   * doesn't have its own venv. Optional for backwards compat; Python
   * resolution degrades to pkg-level-only if omitted.
   */
  readonly root?: string | undefined;
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

/** Per-ecosystem startup timeout for `cargo run` / `go run` cold starts. */
function startupTimeoutForAdapter(ecosystem: string | undefined): number {
  if (ecosystem === "rust") return RUST_STARTUP_TIMEOUT;
  if (ecosystem === "go") return GO_STARTUP_TIMEOUT;
  return DEFAULT_STARTUP_TIMEOUT;
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
    // Scale the default timeout per ecosystem so TS/Python don't pay
    // the compile tax. Rust cargo-run can hit 30-60s cold; Go is
    // faster but still measurable; everything else boots near-instantly.
    startupTimeout = startupTimeoutForAdapter(adapter.ecosystem),
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
      summary: "Port allocation failed. Check if another neutron dev instance is running.",
    };
  }

  // 3. Boot the server
  const server = spawnServer(packageDir, pm, entryFile, port, debug, options.root);

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
 * Extract a flat { name → version } dep map from a pyproject.toml.
 * Handles both PEP 621 ([project.dependencies]) and Poetry
 * ([tool.poetry.dependencies], [tool.poetry.dev-dependencies]).
 * Versions are approximate — we only care about presence for framework
 * detection, not resolution.
 */
function extractPyProjectDeps(manifest: Record<string, unknown>): Record<string, string> {
  const deps: Record<string, string> = {};

  // PEP 621 — [project.dependencies] is an array of PEP 508 strings.
  const project = isRecord(manifest["project"]) ? manifest["project"] : null;
  if (project && Array.isArray(project["dependencies"])) {
    for (const spec of project["dependencies"]) {
      if (typeof spec !== "string") continue;
      const match = spec.match(/^([a-zA-Z0-9][-a-zA-Z0-9_.]*)/);
      if (match?.[1]) {
        deps[match[1]] = spec.slice(match[1].length).trim() || "*";
      }
    }
  }
  if (project && isRecord(project["optional-dependencies"])) {
    for (const group of Object.values(project["optional-dependencies"])) {
      if (!Array.isArray(group)) continue;
      for (const spec of group) {
        if (typeof spec !== "string") continue;
        const match = spec.match(/^([a-zA-Z0-9][-a-zA-Z0-9_.]*)/);
        if (match?.[1]) {
          deps[match[1]] = spec.slice(match[1].length).trim() || "*";
        }
      }
    }
  }

  // Poetry — [tool.poetry.dependencies] is a table keyed by name.
  const tool = isRecord(manifest["tool"]) ? manifest["tool"] : null;
  const poetry = tool && isRecord(tool["poetry"]) ? tool["poetry"] : null;
  if (poetry) {
    for (const field of ["dependencies", "dev-dependencies"]) {
      const raw = poetry[field];
      if (!isRecord(raw)) continue;
      for (const [name, value] of Object.entries(raw)) {
        if (name === "python") continue;
        if (typeof value === "string") {
          deps[name] = value;
        } else if (isRecord(value) && typeof value["version"] === "string") {
          deps[name] = value["version"];
        } else {
          deps[name] = "*";
        }
      }
    }
  }

  return deps;
}

/**
 * Extract a flat { name → version } dep map from a Cargo.toml.
 * Combines [dependencies], [dev-dependencies], and [build-dependencies].
 * Each value may be a version string or a table with a `version` key.
 */
function extractCargoDeps(manifest: Record<string, unknown>): Record<string, string> {
  const deps: Record<string, string> = {};

  for (const field of ["dependencies", "dev-dependencies", "build-dependencies"]) {
    const raw = manifest[field];
    if (!isRecord(raw)) continue;
    for (const [name, value] of Object.entries(raw)) {
      if (typeof value === "string") {
        deps[name] = value;
      } else if (isRecord(value) && typeof value["version"] === "string") {
        deps[name] = value["version"];
      } else {
        deps[name] = "*";
      }
    }
  }

  return deps;
}

/**
 * Parse dependencies from a go.mod file.
 *
 * go.mod syntax (relevant bits):
 *   require github.com/foo/bar v1.2.3
 *   require (
 *     github.com/foo/bar v1.2.3
 *     github.com/baz/qux v4.5.6 // indirect
 *   )
 *
 * We ignore `// indirect` deps for framework detection — those aren't
 * direct users of the adapter framework. Comments and empty lines
 * are skipped.
 */
function extractGoModDeps(content: string): Record<string, string> {
  const deps: Record<string, string> = {};
  const lines = content.split("\n");
  let inBlock = false;

  for (const rawLine of lines) {
    const stripped = rawLine.replace(/\/\/.*$/, "").trim();
    if (!stripped) continue;

    if (stripped.startsWith("require (")) {
      inBlock = true;
      continue;
    }
    if (inBlock && stripped === ")") {
      inBlock = false;
      continue;
    }

    // "require github.com/foo/bar v1.0.0" (single-line form)
    const single = stripped.match(/^require\s+(\S+)\s+(\S+)/);
    if (single?.[1] && single[2]) {
      if (!rawLine.includes("// indirect")) {
        deps[single[1]] = single[2];
      }
      continue;
    }

    // Inside a require(...) block: "github.com/foo/bar v1.0.0"
    if (inBlock) {
      const block = stripped.match(/^(\S+)\s+(\S+)/);
      if (block?.[1] && block[2] && !rawLine.includes("// indirect")) {
        deps[block[1]] = block[2];
      }
    }
  }

  return deps;
}

/**
 * Read all dependencies from whichever manifest the package has. Tries
 * package.json (TS), pyproject.toml (Python), Cargo.toml (Rust), then
 * go.mod (Go).
 */
async function readAllDeps(pkgPath: string, root: string): Promise<Record<string, string>> {
  // Try package.json
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
    return allDeps;
  } catch {
    // Fall through to pyproject / Cargo
  }

  // Try pyproject.toml
  try {
    const pyprojectPath = join(root, pkgPath, "pyproject.toml");
    const content = await readFile(pyprojectPath, "utf-8");
    const parsed = parseToml(content) as Record<string, unknown>;
    return extractPyProjectDeps(parsed);
  } catch {
    // Fall through to Cargo
  }

  // Try Cargo.toml
  try {
    const cargoPath = join(root, pkgPath, "Cargo.toml");
    const content = await readFile(cargoPath, "utf-8");
    const parsed = parseToml(content) as Record<string, unknown>;
    return extractCargoDeps(parsed);
  } catch {
    // Fall through to go.mod
  }

  // Try go.mod
  try {
    const goModPath = join(root, pkgPath, "go.mod");
    const content = await readFile(goModPath, "utf-8");
    return extractGoModDeps(content);
  } catch {
    return {};
  }
}

/**
 * Detect a framework adapter for a package. Tries package.json first,
 * then pyproject.toml — so TS and Python packages both work.
 */
export async function detectFrameworkAdapter(
  pkgPath: string,
  root: string,
): Promise<FrameworkAdapter | null> {
  const { detectAdapter } = await import("@/plugins/builtin/domain/openapi/adapters/index");
  const deps = await readAllDeps(pkgPath, root);
  return detectAdapter(deps);
}
