import type { FormatConfig, LintConfig } from "../config/schema.js";
import type { WorkspaceGraph, WorkspacePackage } from "../graph/types.js";
import type {
  DomainPlugin,
  EcosystemHandler,
  EcosystemPlugin,
  ExecutionContext,
  WatchPathSuggestion,
} from "./types.js";

/**
 * Holds loaded plugins and provides context factory for plugin execution.
 */
export class PluginRegistry {
  private readonly ecosystemPlugins: readonly EcosystemPlugin[];
  private readonly domainPlugins: readonly DomainPlugin[];

  constructor(ecosystem: readonly EcosystemPlugin[], domain: readonly DomainPlugin[]) {
    this.ecosystemPlugins = ecosystem;
    this.domainPlugins = domain;
  }

  /** Find the ecosystem plugin for a package based on its ecosystem name */
  getEcosystemForPackage(pkg: WorkspacePackage): EcosystemPlugin | undefined {
    return this.ecosystemPlugins.find((p) => p.name === pkg.ecosystem);
  }

  /** Find the domain plugin that can handle a bridge artifact */
  async getDomainForArtifact(artifact: string, root: string): Promise<DomainPlugin | undefined> {
    for (const plugin of this.domainPlugins) {
      if (await plugin.detectBridge(artifact, root)) {
        return plugin;
      }
    }
    return undefined;
  }

  /** Find all ecosystem plugins that can handle a domain artifact across target packages */
  async findEcosystemHandlers(
    domain: string,
    artifact: string,
    targets: readonly WorkspacePackage[],
    root: string,
  ): Promise<readonly EcosystemHandler[]> {
    const handlers: EcosystemHandler[] = [];

    for (const pkg of targets) {
      for (const plugin of this.ecosystemPlugins) {
        if (!plugin.canHandleDomainArtifact) {
          continue;
        }
        const capability = await plugin.canHandleDomainArtifact(domain, artifact, pkg, root);
        if (capability) {
          handlers.push({ plugin, pkg, capability });
        }
      }
    }

    return handlers;
  }

  /**
   * Ask plugins to suggest watch paths for a bridge.
   * Domain plugins get priority (they understand the artifact type).
   * Falls back to ecosystem plugin suggestions.
   */
  async suggestWatchPaths(
    source: WorkspacePackage,
    artifact: string,
    packages: ReadonlyMap<string, WorkspacePackage>,
    root: string,
  ): Promise<WatchPathSuggestion | null> {
    // Try domain plugin first — it understands the artifact semantics
    const domain = await this.getDomainForArtifact(artifact, root);
    if (domain?.suggestWatchPaths) {
      const suggestion = await domain.suggestWatchPaths(source, artifact, packages, root);
      if (suggestion) {
        return suggestion;
      }
    }

    // Fall back to ecosystem plugin for the source package
    const ecosystem = this.getEcosystemForPackage(source);
    if (ecosystem?.suggestWatchPaths) {
      return ecosystem.suggestWatchPaths(source, root);
    }

    return null;
  }

  /** Create an ExecutionContext for plugin execution */
  createContext(
    graph: WorkspaceGraph,
    root: string,
    packageManager: string,
    options?: {
      readonly verbose?: boolean;
      readonly lintConfig?: LintConfig;
      readonly formatConfig?: FormatConfig;
    },
  ): ExecutionContext {
    return {
      graph,
      root,
      packageManager,
      verbose: options?.verbose,
      lintConfig: options?.lintConfig,
      formatConfig: options?.formatConfig,
      lintTypescript: options?.lintConfig?.typescript,
      lintDart: options?.lintConfig?.dart,
      formatTypescript: options?.formatConfig?.typescript,
      formatDart: options?.formatConfig?.dart,
      findEcosystemHandlers: async (domain: string, artifact: string) => {
        const allTargets = [...graph.packages.values()];
        return this.findEcosystemHandlers(domain, artifact, allTargets, root);
      },
    };
  }
}
