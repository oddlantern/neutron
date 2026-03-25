import type { WorkspaceGraph, WorkspacePackage } from '../graph/types.js';
import type {
  DomainPlugin,
  EcosystemHandler,
  EcosystemPlugin,
  ExecutionContext,
} from './types.js';

/**
 * Holds loaded plugins and provides context factory for plugin execution.
 */
export class PluginRegistry {
  private readonly ecosystemPlugins: readonly EcosystemPlugin[];
  private readonly domainPlugins: readonly DomainPlugin[];

  constructor(
    ecosystem: readonly EcosystemPlugin[],
    domain: readonly DomainPlugin[],
  ) {
    this.ecosystemPlugins = ecosystem;
    this.domainPlugins = domain;
  }

  /** Find the ecosystem plugin for a package based on its ecosystem name */
  getEcosystemForPackage(pkg: WorkspacePackage): EcosystemPlugin | undefined {
    return this.ecosystemPlugins.find((p) => p.name === pkg.ecosystem);
  }

  /** Find the domain plugin that can handle a bridge artifact */
  async getDomainForArtifact(
    artifact: string,
    root: string,
  ): Promise<DomainPlugin | undefined> {
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
        const capability = await plugin.canHandleDomainArtifact(
          domain,
          artifact,
          pkg,
          root,
        );
        if (capability) {
          handlers.push({ plugin, pkg, capability });
        }
      }
    }

    return handlers;
  }

  /** Create an ExecutionContext for plugin execution */
  createContext(
    graph: WorkspaceGraph,
    root: string,
    packageManager: string,
  ): ExecutionContext {
    return {
      graph,
      root,
      packageManager,
      findEcosystemHandlers: async (domain: string, artifact: string) => {
        const allTargets = [...graph.packages.values()];
        return this.findEcosystemHandlers(domain, artifact, allTargets, root);
      },
    };
  }
}
