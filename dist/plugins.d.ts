import { a as WorkspacePackage, i as WorkspaceGraph } from "./types-D_z_ZsKS.js";
import { g as LintConfig, s as FormatConfig } from "./schema-6LgP2m9L.js";
import { a as ExecutablePipelineStep, c as NeutronPlugin, d as PipelineStepResult, f as STANDARD_ACTIONS, i as EcosystemPlugin, l as PipelineResult, n as DomainPlugin, o as ExecuteResult, p as WatchPathSuggestion, r as EcosystemHandler, s as ExecutionContext, t as DomainCapability, u as PipelineStep } from "./types-C4eBLeVG.js";

//#region src/plugins/registry.d.ts

/**
 * Holds loaded plugins and provides context factory for plugin execution.
 */
declare class PluginRegistry {
  private readonly ecosystemPlugins;
  private readonly domainPlugins;
  constructor(ecosystem: readonly EcosystemPlugin[], domain: readonly DomainPlugin[]);
  /** Find the ecosystem plugin for a package based on its ecosystem name */
  getEcosystemForPackage(pkg: WorkspacePackage): EcosystemPlugin | undefined;
  /** Find the domain plugin that can handle a bridge artifact */
  getDomainForArtifact(artifact: string, root: string): Promise<DomainPlugin | undefined>;
  /** Find all ecosystem plugins that can handle a domain artifact across target packages */
  findEcosystemHandlers(domain: string, artifact: string, targets: readonly WorkspacePackage[], root: string): Promise<readonly EcosystemHandler[]>;
  /**
   * Ask plugins to suggest watch paths for a bridge.
   * Domain plugins get priority (they understand the artifact type).
   * Falls back to ecosystem plugin suggestions.
   */
  suggestWatchPaths(source: WorkspacePackage, artifact: string, packages: ReadonlyMap<string, WorkspacePackage>, root: string): Promise<WatchPathSuggestion | null>;
  /** Create an ExecutionContext for plugin execution */
  createContext(graph: WorkspaceGraph, root: string, packageManager: string, options?: {
    readonly verbose?: boolean;
    readonly dryRun?: boolean;
    readonly force?: boolean;
    readonly lintConfig?: LintConfig;
    readonly formatConfig?: FormatConfig;
  }): ExecutionContext;
}
//#endregion
export { type DomainCapability, type DomainPlugin, type EcosystemHandler, type EcosystemPlugin, type ExecutablePipelineStep, type ExecuteResult, type ExecutionContext, type NeutronPlugin, type PipelineResult, type PipelineStep, type PipelineStepResult, PluginRegistry, STANDARD_ACTIONS, type WatchPathSuggestion };
//# sourceMappingURL=plugins-CcPQOt2I.d.ts.map