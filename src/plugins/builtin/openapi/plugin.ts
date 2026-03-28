import { existsSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import type { WorkspacePackage } from "../../../graph/types.js";
import type {
  DomainPlugin,
  ExecutablePipelineStep,
  ExecuteResult,
  ExecutionContext,
  WatchPathSuggestion,
} from "../../types.js";
import { getScripts, hasDep, readPackageJson, runCommand } from "../exec.js";
import type { FrameworkAdapter } from "./adapters/types.js";
import { assertWithinRoot, detectFrameworkAdapter, exportSpec } from "./exporter.js";

const OPENAPI_FILENAMES: ReadonlySet<string> = new Set([
  "openapi.json",
  "openapi.yaml",
  "openapi.yml",
  "swagger.json",
  "swagger.yaml",
]);

/** Server framework packages that produce OpenAPI specs */
const SERVER_FRAMEWORKS: ReadonlyMap<string, readonly string[]> = new Map([
  ["elysia", ["src/routes/**", "src/routes/**/*.ts"]],
  ["express", ["src/routes/**", "routes/**"]],
  ["fastify", ["src/routes/**", "routes/**"]],
  ["hono", ["src/routes/**", "src/**/*.ts"]],
  ["koa", ["src/routes/**", "routes/**"]],
  ["@nestjs/core", ["src/**/*.controller.ts", "src/**/*.ts"]],
]);

/** Patterns in script values that indicate spec preparation */
const PREPARE_SCRIPT_PATTERNS: readonly string[] = [
  "spec",
  "openapi",
  "swagger",
  "dart",
  "prepare",
];

/**
 * Detect if the source package has a prepare script that post-processes
 * the OpenAPI spec. Checks for well-known script names and patterns.
 */
async function detectPrepareScript(
  source: WorkspacePackage,
  root: string,
): Promise<{ readonly scriptName: string } | null> {
  try {
    const manifest = await readPackageJson(source.path, root);
    const scripts = getScripts(manifest);

    // Check explicit prepare script names first
    const explicitNames = ["openapi:prepare", "spec:prepare", "prepare-spec"];
    for (const name of explicitNames) {
      if (scripts[name]) {
        return { scriptName: name };
      }
    }

    // Check if `prepare` script references spec processing
    const prepareScript = scripts["prepare"];
    if (prepareScript) {
      const lower = prepareScript.toLowerCase();
      const matchesPattern = PREPARE_SCRIPT_PATTERNS.some((p) => lower.includes(p));
      // Exclude the npm default `prepare` hook that just runs install/build
      const isNpmDefault =
        lower === "husky" || lower === "mido install" || lower.startsWith("npm ");
      if (matchesPattern && !isNpmDefault) {
        return { scriptName: "prepare" };
      }
    }
  } catch {
    // manifest unreadable
  }

  return null;
}

/**
 * Find which package in the workspace has the server framework that
 * actually produces the routes. Returns the package and its adapter.
 * Only scans TypeScript packages — other ecosystems are not yet supported.
 */
async function findServerPackage(
  packages: ReadonlyMap<string, WorkspacePackage>,
  root: string,
): Promise<{ readonly path: string; readonly adapter: FrameworkAdapter } | null> {
  for (const [, pkg] of packages) {
    if (pkg.ecosystem !== "typescript") {
      continue;
    }

    const adapter = await detectFrameworkAdapter(pkg.path, root);
    if (adapter) {
      return { path: pkg.path, adapter };
    }
  }

  return null;
}

/**
 * Find which package in the workspace has the server framework that
 * actually produces the routes. Returns watch path suggestions.
 */
async function findRouteSource(
  packages: ReadonlyMap<string, WorkspacePackage>,
  root: string,
): Promise<WatchPathSuggestion | null> {
  for (const [, pkg] of packages) {
    if (pkg.ecosystem !== "typescript") {
      continue;
    }

    try {
      const manifest = await readPackageJson(pkg.path, root);

      for (const [framework, defaultPatterns] of SERVER_FRAMEWORKS) {
        if (hasDep(manifest, framework)) {
          const routesDir = join(root, pkg.path, "src", "routes");
          const watchPatterns = existsSync(routesDir)
            ? [`${pkg.path}/src/routes/**`]
            : defaultPatterns.map((p) => `${pkg.path}/${p}`);

          return {
            paths: watchPatterns,
            reason: `Detected ${framework} routes in ${pkg.path}`,
          };
        }
      }
    } catch {
      // skip unreadable manifests
    }
  }

  return null;
}

/**
 * Determine which artifact path downstream generators should consume.
 * If a prepared spec exists, prefer it over the raw spec.
 */
function resolveArtifactForDownstream(artifact: string, root: string): string {
  // Check for prepared variants
  const ext = artifact.includes(".") ? artifact.slice(artifact.lastIndexOf(".")) : "";
  const base = artifact.slice(0, artifact.length - ext.length);
  const preparedPath = `${base}.prepared${ext}`;

  if (existsSync(join(root, preparedPath))) {
    return preparedPath;
  }

  return artifact;
}

/**
 * Try exporting the spec using the adapter-based exporter.
 * Scans workspace packages for a server framework, boots it, and fetches the spec.
 */
async function tryAdapterExport(
  source: WorkspacePackage,
  artifact: string,
  root: string,
  context: ExecutionContext,
): Promise<ExecuteResult | null> {
  // Check if the source package itself has a framework adapter
  let adapter = await detectFrameworkAdapter(source.path, root);
  let serverPkgPath = source.path;

  // If not, scan the workspace for a server package
  if (!adapter) {
    const serverInfo = await findServerPackage(context.graph.packages, root);
    if (!serverInfo) {
      return null;
    }
    adapter = serverInfo.adapter;
    serverPkgPath = serverInfo.path;
  }

  // Validate paths stay within workspace root
  const packageDir = resolve(root, serverPkgPath);
  const outputPath = resolve(root, artifact);
  assertWithinRoot(packageDir, root);
  assertWithinRoot(outputPath, root);

  // Resolve bridge-level overrides
  const bridge = context.graph.bridges.find(
    (b) => b.source === source.path && b.artifact === artifact,
  );

  return exportSpec({
    packageDir,
    pm: context.packageManager,
    adapter,
    outputPath,
    entryFile: bridge?.entryFile,
    specPath: bridge?.specPath,
    verbose: context.verbose,
  });
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export const openapiPlugin: DomainPlugin = {
  type: "domain",
  name: "openapi",

  async detectBridge(artifact: string): Promise<boolean> {
    const filename = basename(artifact);
    return OPENAPI_FILENAMES.has(filename);
  },

  async exportArtifact(
    source: WorkspacePackage,
    artifact: string,
    root: string,
    context: ExecutionContext,
  ): Promise<ExecuteResult> {
    // Primary: adapter-based export (boot server, fetch spec)
    const adapterResult = await tryAdapterExport(source, artifact, root, context);
    if (adapterResult?.success) {
      return adapterResult;
    }

    // Fallback 1: ecosystem plugin handler
    const handlers = await context.findEcosystemHandlers("openapi", artifact);
    const sourceHandler = handlers.find((h) => h.pkg.path === source.path);
    if (sourceHandler) {
      return sourceHandler.plugin.execute(sourceHandler.capability.action, source, root, context);
    }

    // Fallback 2: openapi:export or swagger:export script
    try {
      const manifest = await readPackageJson(source.path, root);
      const scripts = getScripts(manifest);

      const exportScriptName = scripts["openapi:export"]
        ? "openapi:export"
        : scripts["swagger:export"]
          ? "swagger:export"
          : null;

      if (exportScriptName) {
        const cwd = join(root, source.path);
        return runCommand(context.packageManager, ["run", exportScriptName], cwd);
      }
    } catch {
      // manifest unreadable
    }

    return {
      success: false,
      duration: 0,
      summary: `No export method found for ${source.path} — install an OpenAPI plugin for your framework or add an openapi:export script`,
    };
  },

  async generateDownstream(
    artifact: string,
    targets: readonly WorkspacePackage[],
    root: string,
    context: ExecutionContext,
  ): Promise<readonly ExecuteResult[]> {
    // Prefer prepared artifact if it exists
    const resolvedArtifact = resolveArtifactForDownstream(artifact, root);
    const handlers = await context.findEcosystemHandlers("openapi", resolvedArtifact);

    const targetPaths = new Set(targets.map((t) => t.path));
    const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));

    if (relevantHandlers.length === 0) {
      return [];
    }

    // Derive source path and name from artifact
    const sourcePath = artifact.split("/").slice(0, -1).join("/") || ".";
    const sourcePkg = context.graph.packages.get(sourcePath);
    const sourceName = sourcePkg?.name ?? sourcePath.split("/").pop() ?? "generated";

    const results: ExecuteResult[] = [];
    for (const handler of relevantHandlers) {
      const outputDir = join(root, sourcePath, "generated", handler.plugin.name);
      mkdirSync(outputDir, { recursive: true });

      const ctxWithArtifact: ExecutionContext = {
        ...context,
        sourceName,
        artifactPath: resolvedArtifact,
        outputDir,
      };

      const result = await handler.plugin.execute(
        handler.capability.action,
        handler.pkg,
        root,
        ctxWithArtifact,
      );
      results.push(result);
    }

    return results;
  },

  async buildPipeline(
    source: WorkspacePackage,
    artifact: string,
    targets: readonly WorkspacePackage[],
    root: string,
    context: ExecutionContext,
  ): Promise<readonly ExecutablePipelineStep[]> {
    const steps: ExecutablePipelineStep[] = [];
    const ext = artifact.includes(".") ? artifact.slice(artifact.lastIndexOf(".")) : "";
    const base = artifact.slice(0, artifact.length - ext.length);

    // Step 1: Export spec from framework (skip if artifact already exists on disk)
    const artifactExists = existsSync(join(root, artifact));
    if (!artifactExists) {
      steps.push({
        name: "export-spec",
        plugin: "openapi",
        description: "exporting spec...",
        outputPaths: [artifact],
        execute: () => openapiPlugin.exportArtifact(source, artifact, root, context),
      });
    }

    // Step 2: Prepare spec (if detected)
    const prepareInfo = await detectPrepareScript(source, root);
    if (prepareInfo) {
      const cwd = join(root, source.path);
      const preparedArtifact = `${base}.prepared${ext}`;

      steps.push({
        name: "prepare-spec",
        plugin: "openapi",
        description: "preparing spec...",
        outputPaths: [preparedArtifact, artifact],
        execute: () => runCommand(context.packageManager, ["run", prepareInfo.scriptName], cwd),
      });
    }

    // Step 3+: Generate for each consumer ecosystem
    // Deduplicate by ecosystem — one generation step per ecosystem, not per consumer
    const downstreamArtifact = prepareInfo ? `${base}.prepared${ext}` : artifact;
    const handlers = await context.findEcosystemHandlers("openapi", downstreamArtifact);
    const targetPaths = new Set(targets.map((t) => t.path));
    const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));

    // Deduplicate by ecosystem — if 3 TS consumers exist, generate TS once
    const seenEcosystems = new Set<string>();
    for (const handler of relevantHandlers) {
      if (seenEcosystems.has(handler.plugin.name)) {
        continue;
      }
      seenEcosystems.add(handler.plugin.name);

      const outputDir = join(root, source.path, "generated", handler.plugin.name);

      steps.push({
        name: `generate-${handler.plugin.name}`,
        plugin: handler.plugin.name,
        description: `${handler.capability.description}...`,
        execute: () => {
          mkdirSync(outputDir, { recursive: true });
          const ctxWithArtifact: ExecutionContext = {
            ...context,
            sourceName: source.name,
            artifactPath: downstreamArtifact,
            outputDir,
          };
          return handler.plugin.execute(
            handler.capability.action,
            handler.pkg,
            root,
            ctxWithArtifact,
          );
        },
      });
    }

    return steps;
  },

  async suggestWatchPaths(
    source: WorkspacePackage,
    _artifact: string,
    packages: ReadonlyMap<string, WorkspacePackage>,
    root: string,
  ): Promise<WatchPathSuggestion | null> {
    // First, check if the source package itself has a server framework
    try {
      const manifest = await readPackageJson(source.path, root);
      for (const [framework] of SERVER_FRAMEWORKS) {
        if (hasDep(manifest, framework)) {
          const routesDir = join(root, source.path, "src", "routes");
          const watchPaths = existsSync(routesDir)
            ? [`${source.path}/src/routes/**`]
            : [`${source.path}/src/**`];

          return {
            paths: watchPaths,
            reason: `Detected ${framework} in ${source.path}`,
          };
        }
      }
    } catch {
      // skip
    }

    // If source is a library (e.g., packages/api), look for the actual
    // server framework in other packages that might feed into it
    return findRouteSource(packages, root);
  },
};
