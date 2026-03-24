import type { WorkspaceGraph } from '../graph/types.js';
import type { CheckIssue, CheckResult } from './types.js';
import type { MidoLock } from '../lock.js';

export interface DepOccurrence {
  readonly packagePath: string;
  readonly packageName: string;
  readonly ecosystem: string;
  readonly range: string;
  readonly type: string;
}

export interface VersionMismatch {
  readonly depName: string;
  readonly occurrences: readonly DepOccurrence[];
  readonly lockedRange: string | undefined;
}

/**
 * Collect all non-local dependency occurrences from the workspace graph,
 * grouped by dep name.
 */
export function collectDeps(graph: WorkspaceGraph): Map<string, DepOccurrence[]> {
  const depMap = new Map<string, DepOccurrence[]>();

  for (const pkg of graph.packages.values()) {
    for (const dep of pkg.dependencies) {
      if (dep.range === '<local>') {
        continue;
      }

      const occurrences = depMap.get(dep.name) ?? [];
      occurrences.push({
        packagePath: pkg.path,
        packageName: pkg.name,
        ecosystem: pkg.ecosystem,
        range: dep.range,
        type: dep.type,
      });
      depMap.set(dep.name, occurrences);
    }
  }

  return depMap;
}

/**
 * Find all version mismatches — structured data for use by --fix.
 *
 * If a lock exists and has an entry for a dep, any package whose range
 * differs from the locked range is a mismatch.
 * If no lock entry: flag if ranges differ between packages.
 */
export function findVersionMismatches(
  graph: WorkspaceGraph,
  lock: MidoLock | null,
): VersionMismatch[] {
  const depMap = collectDeps(graph);
  const mismatches: VersionMismatch[] = [];

  for (const [depName, occurrences] of depMap) {
    if (occurrences.length < 2) {
      continue;
    }

    const lockedRange = lock?.resolved[depName];

    if (lockedRange) {
      // Lock-aware: flag any package deviating from locked range
      const deviating = occurrences.filter((o) => o.range !== lockedRange);
      if (deviating.length > 0) {
        mismatches.push({ depName, occurrences, lockedRange });
      }
    } else {
      // No lock entry: flag if ranges differ
      const ranges = new Set(occurrences.map((o) => o.range));
      if (ranges.size > 1) {
        mismatches.push({ depName, occurrences, lockedRange: undefined });
      }
    }
  }

  return mismatches;
}

/**
 * Scan all packages in the workspace graph and flag any dependency
 * that appears in 2+ packages with different version ranges.
 *
 * This is ecosystem-agnostic — it compares raw range strings.
 * "^1.2.3" in package.json and "^1.2.3" in pubspec.yaml are treated as equal.
 * Different strings are flagged regardless of semantic equivalence.
 */
export function checkVersionConsistency(
  graph: WorkspaceGraph,
  lock: MidoLock | null = null,
): CheckResult {
  const depMap = collectDeps(graph);
  const mismatches = findVersionMismatches(graph, lock);

  const issues: CheckIssue[] = mismatches.map((m): CheckIssue => {
    if (m.lockedRange) {
      const deviating = m.occurrences.filter((o) => o.range !== m.lockedRange);
      const details = deviating
        .map((o) => `  ${o.packagePath} (${o.ecosystem}): ${o.range} [${o.type}]`)
        .join('\n');

      return {
        severity: 'error',
        check: 'versions',
        message: `"${m.depName}" deviates from locked range ${m.lockedRange}`,
        details,
      };
    }

    const ranges = new Set(m.occurrences.map((o) => o.range));
    const details = m.occurrences
      .map((o) => `  ${o.packagePath} (${o.ecosystem}): ${o.range} [${o.type}]`)
      .join('\n');

    return {
      severity: 'error',
      check: 'versions',
      message: `"${m.depName}" has ${ranges.size} different version ranges across ${m.occurrences.length} packages`,
      details,
    };
  });

  const depCount = depMap.size;
  const multiPkgDeps = [...depMap.values()].filter((o) => o.length >= 2).length;

  return {
    check: 'versions',
    passed: issues.length === 0,
    issues,
    summary:
      issues.length === 0
        ? `${depCount} dependencies scanned, ${multiPkgDeps} shared — all consistent`
        : `${issues.length} version mismatch(es) found across ${multiPkgDeps} shared dependencies`,
  };
}
