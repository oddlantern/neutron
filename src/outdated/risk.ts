import type { RiskScore } from "@/outdated/types";

const SEVERITY_WEIGHTS: Readonly<Record<string, number>> = {
  major: 40,
  minor: 15,
  patch: 5,
};

const MAX_AFFECTED_SCORE = 20;
const AFFECTED_MULTIPLIER = 5;
const DEPRECATION_PENALTY = 25;
const PEER_CONFLICT_PENALTY = 15;
const MAX_TOTAL = 100;

/**
 * Compute a composite risk score for an outdated dependency.
 *
 * Factors:
 * - Severity (major=40, minor=15, patch=5)
 * - Affected package count (5 per package, capped at 20)
 * - Deprecation (+25 if deprecated)
 * - Peer conflicts (+15 if any conflicts exist)
 */
export function computeRisk(
  severity: "major" | "minor" | "patch",
  affectedPackageCount: number,
  deprecated: boolean,
  peerConflictCount: number,
): RiskScore {
  const severityScore = SEVERITY_WEIGHTS[severity] ?? 5;
  const affectedScore = Math.min(affectedPackageCount * AFFECTED_MULTIPLIER, MAX_AFFECTED_SCORE);
  const deprecationScore = deprecated ? DEPRECATION_PENALTY : 0;
  const peerScore = peerConflictCount > 0 ? PEER_CONFLICT_PENALTY : 0;

  const total = Math.min(severityScore + affectedScore + deprecationScore + peerScore, MAX_TOTAL);

  return {
    total,
    severity: severityScore,
    affectedCount: affectedScore,
    deprecation: deprecationScore,
    peerConflicts: peerScore,
  };
}
