import type { WorkspaceGraph } from '../graph/types.js';
import type { CheckIssue, CheckResult } from './types.js';

interface DepOccurrence {
  readonly packagePath: string;
  readonly packageName: string;
  readonly ecosystem: string;
  readonly range: string;
  readonly type: string;
}

/**
 * Scan all packages in the workspace graph and flag any dependency
 * that appears in 2+ packages with different version ranges.
 *
 * This is ecosystem-agnostic — it compares raw range strings.
 * "^1.2.3" in package.json and "^1.2.3" in pubspec.yaml are treated as equal.
 * Different strings are flagged regardless of semantic equivalence.
 */
export function checkVersionConsistency(graph: WorkspaceGraph): CheckResult {
  // Group all dependency occurrences by dep name
  const depMap = new Map<string, DepOccurrence[]>();

  for (const pkg of graph.packages.values()) {
    for (const dep of pkg.dependencies) {
      // Skip local/path dependencies — they don't have meaningful ranges
      if (dep.range === '<local>') continue;

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

  const issues: CheckIssue[] = [];

  for (const [depName, occurrences] of depMap) {
    // Only check deps that appear in 2+ packages
    if (occurrences.length < 2) continue;

    // Get unique ranges
    const ranges = new Set(occurrences.map((o) => o.range));
    if (ranges.size <= 1) continue;

    // Mismatch found
    const details = occurrences
      .map((o) => `  ${o.packagePath} (${o.ecosystem}): ${o.range} [${o.type}]`)
      .join('\n');

    issues.push({
      severity: 'error',
      check: 'versions',
      message: `"${depName}" has ${ranges.size} different version ranges across ${occurrences.length} packages`,
      details,
    });
  }

  const depCount = depMap.size;
  const multiPkgDeps = [...depMap.values()].filter((o) => o.length >= 2).length;

  return {
    check: 'versions',
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0
      ? `${depCount} dependencies scanned, ${multiPkgDeps} shared — all consistent`
      : `${issues.length} version mismatch(es) found across ${multiPkgDeps} shared dependencies`,
  };
}
