import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { WorkspaceGraph } from '../graph/types.js';
import type { CheckIssue, CheckResult } from './types.js';

/**
 * Validate that all declared bridges reference existing packages
 * and that bridge artifacts exist on disk.
 */
export function checkBridges(graph: WorkspaceGraph): CheckResult {
  const issues: CheckIssue[] = [];

  for (const bridge of graph.bridges) {
    // Check that `from` package exists in the graph
    if (!graph.packages.has(bridge.from)) {
      issues.push({
        severity: 'error',
        check: 'bridges',
        message: `Bridge "from" package not found in workspace: ${bridge.from}`,
        details: `Declared bridge: ${bridge.from} → ${bridge.to} via ${bridge.via}`,
      });
    }

    // Check that `to` package exists in the graph
    if (!graph.packages.has(bridge.to)) {
      issues.push({
        severity: 'error',
        check: 'bridges',
        message: `Bridge "to" package not found in workspace: ${bridge.to}`,
        details: `Declared bridge: ${bridge.from} → ${bridge.to} via ${bridge.via}`,
      });
    }

    // Check that the bridge artifact exists
    const viaPath = resolve(graph.root, bridge.via);
    if (!existsSync(viaPath)) {
      issues.push({
        severity: 'error',
        check: 'bridges',
        message: `Bridge artifact not found: ${bridge.via}`,
        details: `Expected at ${viaPath}\nBridge: ${bridge.from} → ${bridge.to}`,
      });
    }

    // Validate cross-ecosystem: from and to should be in different ecosystems
    const fromPkg = graph.packages.get(bridge.from);
    const toPkg = graph.packages.get(bridge.to);

    if (fromPkg !== undefined && toPkg !== undefined && fromPkg.ecosystem === toPkg.ecosystem) {
      issues.push({
        severity: 'warning',
        check: 'bridges',
        message: `Bridge connects packages in the same ecosystem (${fromPkg.ecosystem}): ${bridge.from} → ${bridge.to}`,
        details: 'Bridges are intended for cross-ecosystem edges. Intra-ecosystem dependencies should be declared in manifest files.',
      });
    }
  }

  return {
    check: 'bridges',
    passed: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
    summary: issues.length === 0
      ? `${graph.bridges.length} bridge(s) validated`
      : `${issues.length} bridge issue(s) found`,
  };
}
