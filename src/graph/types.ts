/**
 * Dependency entry extracted from a manifest file.
 * The range is the raw version string (e.g., "^1.2.3", ">=2.0.0 <3.0.0").
 */
export interface Dependency {
  readonly name: string;
  readonly range: string;
  readonly type: 'production' | 'dev' | 'peer' | 'optional' | 'override';
}

/**
 * A resolved package in the workspace graph.
 * Ecosystem-agnostic — the parser determines which fields to populate.
 */
export interface WorkspacePackage {
  /** Display name from the manifest (e.g., "@nextsaga/server" or "nextsaga_api_client") */
  readonly name: string;
  /** Path relative to workspace root */
  readonly path: string;
  /** Which ecosystem this package belongs to */
  readonly ecosystem: string;
  /** Version declared in the manifest, if any */
  readonly version: string | undefined;
  /** All dependencies extracted from the manifest */
  readonly dependencies: readonly Dependency[];
  /** Intra-workspace path dependencies (resolved package paths) */
  readonly localDependencies: readonly string[];
}

/**
 * A declared cross-ecosystem bridge.
 * Represents a dependency edge that cannot be inferred from manifest files alone.
 */
export interface Bridge {
  /** Package path that depends on the artifact */
  readonly from: string;
  /** Package path that produces the artifact */
  readonly to: string;
  /** Path to the bridge artifact (e.g., openapi.json) */
  readonly via: string;
}

/**
 * The complete workspace graph.
 * Built once from config + parsed manifests, consumed by all checks and commands.
 */
export interface WorkspaceGraph {
  /** Workspace name from config */
  readonly name: string;
  /** Absolute path to workspace root */
  readonly root: string;
  /** All resolved packages, keyed by relative path */
  readonly packages: ReadonlyMap<string, WorkspacePackage>;
  /** Cross-ecosystem bridges from config */
  readonly bridges: readonly Bridge[];
}
