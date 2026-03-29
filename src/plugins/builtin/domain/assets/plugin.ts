import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type {
  DomainPlugin,
  ExecutablePipelineStep,
  ExecuteResult,
  ExecutionContext,
} from "@/plugins/types";
import { scanAssets } from "@/plugins/builtin/domain/assets/scanner";
import type { AssetManifest } from "@/plugins/builtin/domain/assets/types";

const DOMAIN_NAME = "assets";

/**
 * Well-known directory names that indicate an assets package.
 * If the artifact path points to a directory containing any of these,
 * the plugin claims the bridge.
 */
const ASSET_DIRECTORY_MARKERS: readonly string[] = [
  "svg",
  "icons",
  "images",
  "assets",
];

/**
 * Check if a directory looks like an assets package.
 * Requires at least one well-known asset subdirectory.
 */
function looksLikeAssetsPackage(absPath: string): boolean {
  for (const marker of ASSET_DIRECTORY_MARKERS) {
    if (existsSync(join(absPath, marker))) {
      return true;
    }
  }
  return false;
}

export const assetsPlugin: DomainPlugin = {
  type: "domain",
  name: "assets",

  async detectBridge(artifact: string, root: string): Promise<boolean> {
    const absPath = join(root, artifact);

    // Artifact can be a directory (the assets package root)
    if (existsSync(absPath) && looksLikeAssetsPackage(absPath)) {
      return true;
    }

    // Or a manifest file (assets.json, icons.json)
    const ext = artifact.split(".").pop()?.toLowerCase();
    if (ext === "json") {
      // Could be an explicit asset manifest — check parent dir
      const parentDir = artifact.split("/").slice(0, -1).join("/");
      const absParent = join(root, parentDir);
      return looksLikeAssetsPackage(absParent);
    }

    return false;
  },

  async exportArtifact(
    source: WorkspacePackage,
    _artifact: string,
    root: string,
  ): Promise<ExecuteResult> {
    const start = performance.now();

    // For assets, "export" means scanning the directory.
    // The manifest is derived, not produced by a build step.
    const sourceDir = join(root, source.path);
    if (!looksLikeAssetsPackage(sourceDir)) {
      return {
        success: false,
        duration: Math.round(performance.now() - start),
        summary: `No asset directories found in ${source.path}`,
      };
    }

    return {
      success: true,
      duration: Math.round(performance.now() - start),
      summary: "assets detected",
    };
  },

  async generateDownstream(
    artifact: string,
    targets: readonly WorkspacePackage[],
    root: string,
    context: ExecutionContext,
  ): Promise<readonly ExecuteResult[]> {
    // Use the artifact path directly — for assets, the artifact IS the source directory
    const sourcePath = artifact;
    const sourceDir = join(root, sourcePath);

    const manifest = scanAssets(sourceDir, context.graph.name);
    if (manifest.allEntries.length === 0) {
      return [
        {
          success: false,
          duration: 0,
          summary: "No assets found to generate from",
        },
      ];
    }

    const handlers = await context.findEcosystemHandlers(DOMAIN_NAME, artifact);
    const targetPaths = new Set(targets.map((t) => t.path));
    const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));

    if (relevantHandlers.length === 0) {
      return [];
    }

    const sourcePkg = context.graph.packages.get(sourcePath);
    const sourceName = sourcePkg?.name ?? sourcePath.split("/").pop() ?? "assets";

    const results: ExecuteResult[] = [];
    for (const handler of relevantHandlers) {
      const outputDir = join(root, sourcePath, "generated", handler.plugin.name);
      mkdirSync(outputDir, { recursive: true });

      const ctxWithAssets: ExecutionContext = {
        ...context,
        sourceName,
        artifactPath: artifact,
        domainData: manifest,
        outputDir,
      };

      const result = await handler.plugin.execute(
        handler.capability.action,
        handler.pkg,
        root,
        ctxWithAssets,
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
    const shared: { manifest: AssetManifest | undefined } = { manifest: undefined };

    // Step 1: Scan assets
    steps.push({
      name: "scan-assets",
      plugin: "assets",
      description: "scanning assets...",
      outputPaths: [artifact],
      execute: async (): Promise<ExecuteResult> => {
        const start = performance.now();
        const sourceDir = join(root, source.path);

        try {
          shared.manifest = scanAssets(sourceDir, context.graph.name);
          const count = shared.manifest.allEntries.length;
          const catCount = shared.manifest.categories.length;
          return {
            success: true,
            duration: Math.round(performance.now() - start),
            summary: `${count} assets in ${catCount} categories`,
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            duration: Math.round(performance.now() - start),
            summary: `Failed to scan assets: ${msg}`,
          };
        }
      },
    });

    // Discover ecosystem handlers
    const handlers = await context.findEcosystemHandlers(DOMAIN_NAME, artifact);
    const targetPaths = new Set(targets.map((t) => t.path));
    const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));

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
        description: `generating ${handler.plugin.name} asset wrappers...`,
        execute: async (): Promise<ExecuteResult> => {
          if (!shared.manifest) {
            return {
              success: false,
              duration: 0,
              summary: "Cannot generate — asset scan did not run",
            };
          }

          mkdirSync(outputDir, { recursive: true });

          const ctxWithAssets: ExecutionContext = {
            ...context,
            sourceName: source.name,
            artifactPath: artifact,
            domainData: shared.manifest,
            outputDir,
          };

          return handler.plugin.execute(
            handler.capability.action,
            handler.pkg,
            root,
            ctxWithAssets,
          );
        },
      });
    }

    return steps;
  },
};
