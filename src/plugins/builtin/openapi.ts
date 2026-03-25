import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { WorkspacePackage } from '../../graph/types.js';
import type {
  DomainPlugin,
  ExecutablePipelineStep,
  ExecuteResult,
  ExecutionContext,
  WatchPathSuggestion,
} from '../types.js';
import { getScripts, hasDep, readPackageJson, runCommand } from './exec.js';

const OPENAPI_FILENAMES: ReadonlySet<string> = new Set([
  'openapi.json',
  'openapi.yaml',
  'openapi.yml',
  'swagger.json',
  'swagger.yaml',
]);

/** Server framework packages that produce OpenAPI specs */
const SERVER_FRAMEWORKS: ReadonlyMap<string, readonly string[]> = new Map([
  ['elysia', ['src/routes/**', 'src/routes/**/*.ts']],
  ['express', ['src/routes/**', 'routes/**']],
  ['fastify', ['src/routes/**', 'routes/**']],
  ['hono', ['src/routes/**', 'src/**/*.ts']],
  ['koa', ['src/routes/**', 'routes/**']],
]);

/** Patterns in script values that indicate spec preparation */
const PREPARE_SCRIPT_PATTERNS: readonly string[] = [
  'spec',
  'openapi',
  'swagger',
  'dart',
  'prepare',
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
    const explicitNames = ['openapi:prepare', 'spec:prepare', 'prepare-spec'];
    for (const name of explicitNames) {
      if (scripts[name]) {
        return { scriptName: name };
      }
    }

    // Check if `prepare` script references spec processing
    const prepareScript = scripts['prepare'];
    if (prepareScript) {
      const lower = prepareScript.toLowerCase();
      const matchesPattern = PREPARE_SCRIPT_PATTERNS.some((p) => lower.includes(p));
      // Exclude the npm default `prepare` hook that just runs install/build
      const isNpmDefault =
        lower === 'husky' || lower === 'mido install' || lower.startsWith('npm ');
      if (matchesPattern && !isNpmDefault) {
        return { scriptName: 'prepare' };
      }
    }
  } catch {
    // manifest unreadable
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
    if (pkg.ecosystem !== 'typescript') {
      continue;
    }

    try {
      const manifest = await readPackageJson(pkg.path, root);

      for (const [framework, defaultPatterns] of SERVER_FRAMEWORKS) {
        if (hasDep(manifest, framework)) {
          const routesDir = join(root, pkg.path, 'src', 'routes');
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
  const ext = artifact.includes('.') ? artifact.slice(artifact.lastIndexOf('.')) : '';
  const base = artifact.slice(0, artifact.length - ext.length);
  const preparedPath = `${base}.prepared${ext}`;

  if (existsSync(join(root, preparedPath))) {
    return preparedPath;
  }

  return artifact;
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export const openapiPlugin: DomainPlugin = {
  type: 'domain',
  name: 'openapi',

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
    const handlers = await context.findEcosystemHandlers('openapi', artifact);
    const sourceHandler = handlers.find((h) => h.pkg.path === source.path);

    if (sourceHandler) {
      return sourceHandler.plugin.execute(sourceHandler.capability.action, source, root, context);
    }

    // Fallback: look for openapi:export script in source package
    try {
      const manifest = await readPackageJson(source.path, root);
      const scripts = getScripts(manifest);

      const exportScriptName = scripts['openapi:export']
        ? 'openapi:export'
        : scripts['swagger:export']
          ? 'swagger:export'
          : null;

      if (exportScriptName) {
        const cwd = join(root, source.path);
        return runCommand(context.packageManager, ['run', exportScriptName], cwd);
      }
    } catch {
      // manifest unreadable
    }

    return {
      success: false,
      duration: 0,
      summary: `No export method found for ${source.path} — add a "generate" script or install an OpenAPI export plugin`,
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
    const handlers = await context.findEcosystemHandlers('openapi', resolvedArtifact);

    const targetPaths = new Set(targets.map((t) => t.path));
    const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));

    if (relevantHandlers.length === 0) {
      return [];
    }

    const results: ExecuteResult[] = [];

    for (const handler of relevantHandlers) {
      const result = await handler.plugin.execute(
        handler.capability.action,
        handler.pkg,
        root,
        context,
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
    const ext = artifact.includes('.') ? artifact.slice(artifact.lastIndexOf('.')) : '';
    const base = artifact.slice(0, artifact.length - ext.length);

    // Step 1: Export spec from framework
    steps.push({
      name: 'export-spec',
      plugin: 'openapi',
      description: 'exporting spec...',
      outputPaths: [artifact],
      execute: () => openapiPlugin.exportArtifact(source, artifact, root, context),
    });

    // Step 2: Prepare spec (if detected)
    const prepareInfo = await detectPrepareScript(source, root);
    if (prepareInfo) {
      const cwd = join(root, source.path);
      const preparedArtifact = `${base}.prepared${ext}`;

      steps.push({
        name: 'prepare-spec',
        plugin: 'openapi',
        description: 'preparing spec...',
        outputPaths: [preparedArtifact, artifact],
        execute: () => runCommand(context.packageManager, ['run', prepareInfo.scriptName], cwd),
      });
    }

    // Step 3+: Downstream generators from ecosystem plugins
    // If a prepare step exists, downstream generators should consume the prepared artifact
    // (determined at build time, not by checking filesystem — the file may not exist yet)
    const downstreamArtifact = prepareInfo ? `${base}.prepared${ext}` : artifact;
    const handlers = await context.findEcosystemHandlers('openapi', downstreamArtifact);
    const targetPaths = new Set(targets.map((t) => t.path));
    const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));

    for (const handler of relevantHandlers) {
      steps.push({
        name: `generate-${handler.plugin.name}`,
        plugin: handler.plugin.name,
        description: `${handler.capability.description}...`,
        execute: () =>
          handler.plugin.execute(handler.capability.action, handler.pkg, root, context),
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
          const routesDir = join(root, source.path, 'src', 'routes');
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
