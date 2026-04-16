import { a as WorkspacePackage, i as WorkspaceGraph, n as BridgeConsumer, r as Dependency, t as Bridge } from "./types-D_z_ZsKS.js";
import { n as buildWorkspaceGraph, t as ParserRegistry } from "./workspace-Bb34gJ5L.js";

//#region src/graph/glob.d.ts

/**
 * Expand package path patterns that contain `*` wildcards.
 * Supports single-level `*` expansion (e.g., `apps/*`, `packages/*`).
 * Literal paths (no `*`) are returned as-is.
 *
 * @returns Deduplicated list of expanded paths.
 */
declare function expandPackageGlobs(patterns: readonly string[], root: string): readonly string[];
//#endregion
//#region src/graph/topo.d.ts
/**
 * Detect dependency cycles in the package graph.
 * Uses DFS with three-color marking (white → gray → black).
 *
 * @returns Array of cycles, each cycle is an array of package paths forming the loop.
 *          Empty array means no cycles.
 */
declare function detectCycles(packages: ReadonlyMap<string, WorkspacePackage>): readonly (readonly string[])[];
/**
 * Topological sort of packages using Kahn's algorithm.
 * Returns package paths in dependency order (dependencies first).
 *
 * Only considers edges within the provided package set — external
 * dependencies are ignored.
 *
 * @param subset - If provided, only sort these paths (must be a subset of packages).
 *                 Dependencies outside the subset are ignored for ordering.
 * @throws Error if a cycle is detected (should not happen if detectCycles ran first).
 */
//#endregion
export { type Bridge, type BridgeConsumer, type Dependency, type ParserRegistry, type WorkspaceGraph, type WorkspacePackage, buildWorkspaceGraph, detectCycles, expandPackageGlobs };
//# sourceMappingURL=graph-DoC186jg.d.ts.map