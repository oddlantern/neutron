import { classifyUpdate, stripRange } from "@/outdated/collect";
import { fetchMetadata } from "@/outdated/registry";
import { computeRisk } from "@/outdated/risk";
import type { DepUsage, OutdatedDep, PeerConflict } from "@/outdated/types";

const CONCURRENCY = 10;

/** Result of Level 1 analysis including skip count for diagnostics. */
export interface Level1Result {
  readonly outdated: readonly OutdatedDep[];
  readonly skipped: number;
}

/**
 * Detect peer dependency conflicts between the updated package's
 * peer requirements and the workspace's current dependency ranges.
 */
function detectPeerConflicts(
  peerDeps: Readonly<Record<string, string>> | undefined,
  workspaceDeps: ReadonlyMap<string, string>,
): readonly PeerConflict[] {
  if (!peerDeps) {
    return [];
  }

  const conflicts: PeerConflict[] = [];

  for (const [peerName, requiredRange] of Object.entries(peerDeps)) {
    const workspaceRange = workspaceDeps.get(peerName);
    if (!workspaceRange) {
      // Peer dep not in workspace — not necessarily a conflict, skip
      continue;
    }

    // Compare major versions as a heuristic for compatibility
    const requiredVersion = stripRange(requiredRange);
    const workspaceVersion = stripRange(workspaceRange);

    const [reqMajor] = requiredVersion.split(".").map(Number);
    const [wsMajor] = workspaceVersion.split(".").map(Number);

    const conflicting = reqMajor !== undefined && wsMajor !== undefined && reqMajor !== wsMajor;

    if (conflicting) {
      conflicts.push({ peerName, requiredRange, workspaceRange, conflicting });
    }
  }

  return conflicts;
}

/**
 * Run Level 1 analysis: fetch enriched metadata, detect peer conflicts, compute risk scores.
 *
 * @param deps - Collected workspace dependencies
 * @param workspaceDeps - Flat map of all workspace dep name → range (for peer conflict detection)
 * @returns Outdated dependencies enriched with metadata, peer conflicts, and risk scores
 */
export async function runLevel1(
  deps: readonly DepUsage[],
  workspaceDeps: ReadonlyMap<string, string>,
): Promise<Level1Result> {
  const outdated: OutdatedDep[] = [];
  let skipped = 0;

  for (let i = 0; i < deps.length; i += CONCURRENCY) {
    const batch = deps.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (dep) => {
        const metadata = await fetchMetadata(dep.name, dep.ecosystem);
        return { dep, metadata };
      }),
    );

    for (const { dep, metadata } of results) {
      if (!metadata) {
        skipped++;
        continue;
      }

      const current = stripRange(dep.range);
      const severity = classifyUpdate(current, metadata.latest);

      if (!severity) {
        continue;
      }

      const peerConflicts = detectPeerConflicts(metadata.peerDependencies, workspaceDeps);
      const risk = computeRisk(
        severity,
        dep.packages.length,
        !!metadata.deprecated,
        peerConflicts.length,
      );

      outdated.push({
        name: dep.name,
        ecosystem: dep.ecosystem,
        workspaceRange: dep.range,
        packages: dep.packages,
        latest: metadata.latest,
        severity,
        metadata,
        peerConflicts,
        risk,
      });
    }
  }

  return { outdated, skipped };
}
