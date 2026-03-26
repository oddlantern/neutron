import type {
  FormatDartConfig,
  FormatTypescriptConfig,
  LintDartConfig,
  LintTypescriptConfig,
} from "../config/schema.js";
import type { WorkspaceGraph, WorkspacePackage } from "../graph/types.js";

/** Standard action names shared across ecosystem plugins */
export const STANDARD_ACTIONS: {
  readonly LINT: "lint";
  readonly LINT_FIX: "lint:fix";
  readonly FORMAT: "format";
  readonly FORMAT_CHECK: "format:check";
  readonly BUILD: "build";
  readonly TYPECHECK: "typecheck";
  readonly CODEGEN: "codegen";
} = {
  LINT: "lint",
  LINT_FIX: "lint:fix",
  FORMAT: "format",
  FORMAT_CHECK: "format:check",
  BUILD: "build",
  TYPECHECK: "typecheck",
  CODEGEN: "codegen",
};

/** Result of a plugin execution */
export interface ExecuteResult {
  readonly success: boolean;
  readonly duration: number;
  /** Human-readable summary (e.g., "generated 3 Dart files") */
  readonly summary: string;
  /** Captured stdout/stderr for error display */
  readonly output?: string | undefined;
}

// ─── Pipeline types ──────────────────────────────────────────────────────────

/** Metadata describing a single pipeline step */
export interface PipelineStep {
  /** Short identifier (e.g., "export-spec", "prepare-spec", "generate-ts") */
  readonly name: string;
  /** Which plugin owns this step (e.g., "openapi", "typescript", "dart") */
  readonly plugin: string;
  /** Human-readable description shown during execution */
  readonly description: string;
}

/** An executable pipeline step — includes the step metadata plus how to run it */
export interface ExecutablePipelineStep extends PipelineStep {
  /** Execute this step */
  execute(): Promise<ExecuteResult>;
  /** Output file paths to hash for change detection (relative to root) */
  readonly outputPaths?: readonly string[] | undefined;
}

/** Result of a single pipeline step execution */
export interface PipelineStepResult {
  readonly step: PipelineStep;
  readonly success: boolean;
  readonly duration: number;
  readonly output?: string | undefined;
  /** Whether output files changed (true if no outputPaths specified) */
  readonly changed: boolean;
}

/** Result of a full pipeline execution */
export interface PipelineResult {
  readonly success: boolean;
  readonly totalDuration: number;
  readonly steps: readonly PipelineStepResult[];
}

/** Watch path suggestion returned by plugins during init */
export interface WatchPathSuggestion {
  readonly paths: readonly string[];
  readonly reason: string;
}

/**
 * Ecosystem plugin — handles language-level operations.
 *
 * Examples: mido-typescript, mido-dart, mido-rust
 */
export interface EcosystemPlugin {
  readonly type: "ecosystem";
  /** Unique identifier (e.g., "typescript", "dart") */
  readonly name: string;
  /** Manifest filename this plugin understands */
  readonly manifest: string;

  /**
   * Can this plugin handle the given package?
   * Inspect dependencies, file structure, etc.
   */
  detect(pkg: WorkspacePackage, root: string): Promise<boolean>;

  /**
   * What file patterns should be watched for this package?
   * Return glob patterns relative to the package root.
   */
  getWatchPatterns(pkg: WorkspacePackage, root: string): Promise<readonly string[]>;

  /**
   * Get available actions for this package.
   * Inspects manifest scripts, dependencies, etc.
   * Returns action names this plugin can execute (e.g., "generate", "build", "codegen").
   */
  getActions(pkg: WorkspacePackage, root: string): Promise<readonly string[]>;

  /**
   * Execute an action on the package.
   * The action name comes from getActions() or from a domain plugin request.
   */
  execute(
    action: string,
    pkg: WorkspacePackage,
    root: string,
    context: ExecutionContext,
  ): Promise<ExecuteResult>;

  /**
   * Can this plugin generate a client/output from a domain artifact?
   * Domain plugins call this to discover which ecosystems can produce output.
   * Returns null if it can't handle it, or a description of what it would produce.
   */
  canHandleDomainArtifact?(
    domain: string,
    artifact: string,
    pkg: WorkspacePackage,
    root: string,
  ): Promise<DomainCapability | null>;

  /**
   * Suggest watch paths for a bridge during init.
   * Ecosystem plugins know their package's internal structure
   * (e.g., TypeScript watches src/**\/*.ts, Dart watches lib/**\/*.dart).
   */
  suggestWatchPaths?(pkg: WorkspacePackage, root: string): Promise<WatchPathSuggestion | null>;
}

/** Returned by canHandleDomainArtifact when the plugin can handle it */
export interface DomainCapability {
  /** Action name to pass to execute() */
  readonly action: string;
  /** Human-readable description */
  readonly description: string;
}

/**
 * Domain plugin — handles protocol/spec-level operations.
 * Delegates actual code generation to ecosystem plugins.
 *
 * Examples: mido-openapi, mido-graphql, mido-protobuf
 */
export interface DomainPlugin {
  readonly type: "domain";
  /** Unique identifier (e.g., "openapi", "graphql") */
  readonly name: string;

  /**
   * Can this plugin handle the given bridge?
   * Inspect the artifact file extension, content, etc.
   */
  detectBridge(artifact: string, root: string): Promise<boolean>;

  /**
   * Export/produce the artifact from the source package.
   * Uses ecosystem plugins to run the actual export command.
   */
  exportArtifact(
    source: WorkspacePackage,
    artifact: string,
    root: string,
    context: ExecutionContext,
  ): Promise<ExecuteResult>;

  /**
   * Generate all downstream outputs from the artifact.
   * Discovers ecosystem plugins that can handle this domain,
   * then delegates to each one.
   */
  generateDownstream(
    artifact: string,
    targets: readonly WorkspacePackage[],
    root: string,
    context: ExecutionContext,
  ): Promise<readonly ExecuteResult[]>;

  /**
   * Build the full executable pipeline for a bridge.
   * Returns an ordered list of steps: export → prepare → downstream generators.
   * The pipeline runner executes these sequentially with per-step timing and output diffing.
   */
  buildPipeline?(
    source: WorkspacePackage,
    artifact: string,
    targets: readonly WorkspacePackage[],
    root: string,
    context: ExecutionContext,
  ): Promise<readonly ExecutablePipelineStep[]>;

  /**
   * Suggest watch paths for a bridge during init.
   * Domain plugins can inspect the workspace to find the real source of changes
   * (e.g., Elysia routes in apps/server/src/routes/ for an OpenAPI bridge).
   */
  suggestWatchPaths?(
    source: WorkspacePackage,
    artifact: string,
    packages: ReadonlyMap<string, WorkspacePackage>,
    root: string,
  ): Promise<WatchPathSuggestion | null>;
}

/**
 * Execution context provided by mido core to plugins.
 * Gives plugins access to the registry without importing other plugins directly.
 */
export interface ExecutionContext {
  /** The full workspace graph */
  readonly graph: WorkspaceGraph;
  /** Find ecosystem plugins that can handle a domain artifact */
  findEcosystemHandlers(domain: string, artifact: string): Promise<readonly EcosystemHandler[]>;
  /** Detected package manager ("bun", "npm", "pnpm", "yarn") */
  readonly packageManager: string;
  /** Workspace root absolute path */
  readonly root: string;
  /** Artifact path (relative to root) when executing a domain-triggered action */
  readonly artifactPath?: string | undefined;
  /** Verbose logging enabled */
  readonly verbose?: boolean | undefined;
  /** Ecosystem-specific lint config (resolved by the command before calling plugin) */
  readonly lintTypescript?: LintTypescriptConfig | undefined;
  /** Ecosystem-specific lint config for Dart */
  readonly lintDart?: LintDartConfig | undefined;
  /** Ecosystem-specific format config (resolved by the command before calling plugin) */
  readonly formatTypescript?: FormatTypescriptConfig | undefined;
  /** Ecosystem-specific format config for Dart */
  readonly formatDart?: FormatDartConfig | undefined;
  /** Pre-resolved file paths (relative to package root) — plugins use these instead of scanning directories */
  readonly resolvedFiles?: readonly string[] | undefined;
  /** Opaque domain data — passed from domain plugins to ecosystem plugins (e.g., validated design tokens) */
  readonly domainData?: unknown;
}

export interface EcosystemHandler {
  readonly plugin: EcosystemPlugin;
  readonly pkg: WorkspacePackage;
  readonly capability: DomainCapability;
}

export type MidoPlugin = EcosystemPlugin | DomainPlugin;
