import { n as CheckResult, r as Severity, t as CheckIssue } from "./types-CZkj_bZ_.js";
import { i as WorkspaceGraph } from "./types-D_z_ZsKS.js";
import { o as EnvConfig } from "./schema-6LgP2m9L.js";
import { z } from "zod";

//#region src/checks/bridges.d.ts
/**
 * Validate that all declared bridges reference existing packages
 * and that bridge artifacts exist on disk.
 */
declare function checkBridges(graph: WorkspaceGraph): CheckResult;
//#endregion
//#region src/checks/env.d.ts
/**
 * Check that all shared keys exist in every declared env file.
 */
declare function checkEnvParity(envConfig: EnvConfig, root: string): Promise<CheckResult>;
//#endregion
//#region src/checks/staleness.d.ts
/**
 * Check whether generated output directories exist for all bridges.
 * All bridges should produce `<source>/generated/<ecosystem>/`.
 *
 * Reports warnings (not errors) — doesn't block pre-commit or CI.
 */
declare function checkStaleness(graph: WorkspaceGraph, root: string): Promise<CheckResult>;
//#endregion
//#region src/lock.d.ts
declare const lockSchemaV2: z.ZodObject<{
  version: z.ZodLiteral<2>;
  resolved: z.ZodRecord<z.ZodString, z.ZodObject<{
    /** The agreed-upon version range (e.g., "^3.25.67") */
    range: z.ZodString;
    /** SHA-256 hash of the range string for tamper detection */
    integrity: z.ZodString;
    /** Ecosystems where this dependency appears */
    ecosystems: z.ZodArray<z.ZodString, "many">;
    /** ISO 8601 timestamp when this entry was resolved */
    resolvedAt: z.ZodString;
  }, "strip", z.ZodTypeAny, {
    ecosystems: string[];
    range: string;
    integrity: string;
    resolvedAt: string;
  }, {
    ecosystems: string[];
    range: string;
    integrity: string;
    resolvedAt: string;
  }>>;
}, "strip", z.ZodTypeAny, {
  version: 2;
  resolved: Record<string, {
    ecosystems: string[];
    range: string;
    integrity: string;
    resolvedAt: string;
  }>;
}, {
  version: 2;
  resolved: Record<string, {
    ecosystems: string[];
    range: string;
    integrity: string;
    resolvedAt: string;
  }>;
}>;
type MidoLock = z.infer<typeof lockSchemaV2>;
/** Verify a lock entry's integrity hash matches its range */
//#endregion
//#region src/checks/versions.d.ts
interface DepOccurrence {
  readonly packagePath: string;
  readonly packageName: string;
  readonly ecosystem: string;
  readonly range: string;
  readonly type: string;
}
interface VersionMismatch {
  readonly depName: string;
  readonly occurrences: readonly DepOccurrence[];
  readonly lockedRange: string | undefined;
}
/**
 * Collect all non-local dependency occurrences from the workspace graph,
 * grouped by dep name.
 */
declare function collectDeps(graph: WorkspaceGraph): Map<string, DepOccurrence[]>;
/**
 * Find all version mismatches — structured data for use by --fix.
 *
 * If a lock exists and has an entry for a dep, any package whose range
 * differs from the locked range is a mismatch.
 * If no lock entry: flag if ranges differ between packages.
 */
declare function findVersionMismatches(graph: WorkspaceGraph, lock: MidoLock | null): VersionMismatch[];
/**
 * Scan all packages in the workspace graph and flag any dependency
 * that appears in 2+ packages with different version ranges.
 *
 * This is ecosystem-agnostic — it compares raw range strings.
 * "^1.2.3" in package.json and "^1.2.3" in pubspec.yaml are treated as equal.
 * Different strings are flagged regardless of semantic equivalence.
 */
declare function checkVersionConsistency(graph: WorkspaceGraph, lock?: MidoLock | null): CheckResult;
//#endregion
export { type CheckIssue, type CheckResult, type Severity, checkBridges, checkEnvParity, checkStaleness, checkVersionConsistency, collectDeps, findVersionMismatches };
//# sourceMappingURL=checks-ChluKnTy.d.ts.map