import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import type { MidoConfig } from "../config/schema.js";
import type { ManifestParser } from "../parsers/types.js";
import type { Bridge, WorkspaceGraph, WorkspacePackage } from "./types.js";

/** Registry of parsers keyed by manifest filename */
export type ParserRegistry = ReadonlyMap<string, ManifestParser>;

/**
 * Build the complete workspace graph from config and manifest parsers.
 *
 * Steps:
 * 1. For each ecosystem, resolve package paths
 * 2. Parse each manifest using the ecosystem's parser
 * 3. Resolve local dependency paths to workspace-relative paths
 * 4. Assemble bridges from config
 */
export async function buildWorkspaceGraph(
  config: MidoConfig,
  root: string,
  parsers: ParserRegistry,
): Promise<WorkspaceGraph> {
  const packages = new Map<string, WorkspacePackage>();
  const errors: string[] = [];

  for (const [ecosystemName, ecosystemConfig] of Object.entries(config.ecosystems)) {
    const parser = parsers.get(ecosystemConfig.manifest);

    if (!parser) {
      errors.push(
        `No parser registered for manifest "${ecosystemConfig.manifest}" ` +
          `(ecosystem: ${ecosystemName})`,
      );
      continue;
    }

    for (const pkgGlob of ecosystemConfig.packages) {
      // For now, treat each entry as a literal path (no glob expansion in PoC)
      const pkgDir = resolve(root, pkgGlob);
      const manifestPath = join(pkgDir, ecosystemConfig.manifest);

      if (!existsSync(manifestPath)) {
        errors.push(
          `Manifest not found: ${manifestPath} ` +
            `(ecosystem: ${ecosystemName}, package: ${pkgGlob})`,
        );
        continue;
      }

      try {
        const parsed = await parser.parse(manifestPath);
        const relativePath = relative(root, pkgDir);

        // Resolve local dependency paths to workspace-relative paths
        const localDependencies = parsed.localDependencyPaths
          .map((absPath) => relative(root, absPath))
          .filter((relPath) => packages.has(relPath) || isInPackageList(config, relPath));

        const pkg: WorkspacePackage = {
          name: parsed.name,
          path: relativePath,
          ecosystem: ecosystemName,
          version: parsed.version,
          dependencies: parsed.dependencies,
          localDependencies,
        };

        packages.set(relativePath, pkg);
      } catch (cause) {
        errors.push(
          `Failed to parse ${manifestPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Workspace graph build failed with ${errors.length} error(s):\n` +
        errors.map((e) => `  - ${e}`).join("\n"),
    );
  }

  // Re-resolve local dependencies now that all packages are discovered
  const resolvedPackages = new Map<string, WorkspacePackage>();

  for (const [path, pkg] of packages) {
    const resolvedLocalDeps = pkg.localDependencies.filter((dep) => packages.has(dep));
    resolvedPackages.set(path, { ...pkg, localDependencies: resolvedLocalDeps });
  }

  const bridges: Bridge[] = (config.bridges ?? []).map((b) => ({
    source: b.source,
    artifact: b.artifact,
    consumers: b.consumers ?? (b.target ? [b.target] : []),
    run: b.run,
    watch: b.watch,
    entryFile: b.entryFile,
    specPath: b.specPath,
  }));

  return {
    name: config.workspace,
    root,
    packages: resolvedPackages,
    bridges,
  };
}

/** Check if a relative path is declared in any ecosystem's package list */
function isInPackageList(config: MidoConfig, relPath: string): boolean {
  for (const eco of Object.values(config.ecosystems)) {
    if (eco.packages.includes(relPath)) {
      return true;
    }
  }
  return false;
}
