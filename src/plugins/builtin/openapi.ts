import { basename } from 'node:path';

import type { WorkspacePackage } from '../../graph/types.js';
import type { DomainPlugin, ExecuteResult, ExecutionContext } from '../types.js';

const OPENAPI_FILENAMES: ReadonlySet<string> = new Set([
  'openapi.json',
  'openapi.yaml',
  'openapi.yml',
  'swagger.json',
  'swagger.yaml',
]);

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
    // Find the ecosystem plugin for the source package
    const handlers = await context.findEcosystemHandlers('openapi', artifact);
    const sourceHandler = handlers.find((h) => h.pkg.path === source.path);

    if (sourceHandler) {
      return sourceHandler.plugin.execute(
        sourceHandler.capability.action,
        source,
        root,
        context,
      );
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
    const handlers = await context.findEcosystemHandlers('openapi', artifact);

    // Filter handlers to only those targeting the specified packages
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
};
