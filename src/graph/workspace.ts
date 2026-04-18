import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import type { NeutronConfig } from "@/config/schema";
import type { ManifestParser } from "@/parsers/types";
import type { Bridge, BridgeConsumer, WorkspaceGraph, WorkspacePackage } from "@/graph/types";
import { expandPackageGlobs } from "@/graph/glob";
import { detectCycles } from "@/graph/topo";

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
  config: NeutronConfig,
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

    const expandedPaths = expandPackageGlobs(ecosystemConfig.packages, root);

    for (const pkgPath of expandedPaths) {
      const pkgDir = resolve(root, pkgPath);
      const manifestPath = join(pkgDir, ecosystemConfig.manifest);

      if (!existsSync(manifestPath)) {
        errors.push(
          `Manifest not found: ${manifestPath} ` +
            `(ecosystem: ${ecosystemName}, package: ${pkgPath})`,
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

  // Zero-packages-total is a config error: every glob expanded to nothing.
  // A missing parent dir or a too-specific pattern may be the cause.
  // Checked after errors so that parser/manifest failures surface with detail.
  if (packages.size === 0) {
    throw new Error(
      "No packages found. Every ecosystem's `packages:` pattern expanded to an empty set. " +
        "Check that your paths/globs match real directories (and that those directories " +
        "contain the expected manifests).",
    );
  }

  // Re-resolve local dependencies now that all packages are discovered
  const resolvedPackages = new Map<string, WorkspacePackage>();

  for (const [path, pkg] of packages) {
    const resolvedLocalDeps = pkg.localDependencies.filter((dep) => packages.has(dep));
    resolvedPackages.set(path, { ...pkg, localDependencies: resolvedLocalDeps });
  }

  // Detect dependency cycles before proceeding
  const cycles = detectCycles(resolvedPackages);
  if (cycles.length > 0) {
    const formatted = cycles.map((cycle) => `  ${cycle.join(" → ")}`).join("\n");
    throw new Error(`Dependency cycle(s) detected in workspace graph:\n${formatted}`);
  }

  const bridges: Bridge[] = (config.bridges ?? []).map((b) => {
    // Normalize consumers: string | { path, format? } → BridgeConsumer[]
    const rawConsumers = b.consumers ?? (b.target ? [b.target] : []);
    const consumers: BridgeConsumer[] = rawConsumers.map((c) =>
      typeof c === "string" ? { path: c } : { path: c.path, format: c.format },
    );

    return {
      source: b.source,
      artifact: b.artifact,
      consumers,
      run: b.run,
      watch: b.watch,
      entryFile: b.entryFile,
      specPath: b.specPath,
      exclude: b.exclude,
    };
  });

  return {
    name: config.workspace,
    root,
    packages: resolvedPackages,
    bridges,
  };
}

/** Check if a relative path is declared in any ecosystem's package list */
function isInPackageList(config: NeutronConfig, relPath: string): boolean {
  for (const eco of Object.values(config.ecosystems)) {
    if (eco.packages.includes(relPath)) {
      return true;
    }
  }
  return false;
}
