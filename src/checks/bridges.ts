import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { WorkspaceGraph } from "../graph/types.js";
import type { CheckIssue, CheckResult } from "./types.js";

/**
 * Validate that all declared bridges reference existing packages
 * and that bridge artifacts exist on disk.
 */
export function checkBridges(graph: WorkspaceGraph): CheckResult {
  const issues: CheckIssue[] = [];

  for (const bridge of graph.bridges) {
    // Check that source package exists in the graph
    if (!graph.packages.has(bridge.source)) {
      issues.push({
        severity: "error",
        check: "bridges",
        message: `Bridge source package not found in workspace: ${bridge.source}`,
        details: `Declared bridge: ${bridge.source} → ${bridge.target} via ${bridge.artifact}`,
      });
    }

    // Check that target package exists in the graph
    if (!graph.packages.has(bridge.target)) {
      issues.push({
        severity: "error",
        check: "bridges",
        message: `Bridge target package not found in workspace: ${bridge.target}`,
        details: `Declared bridge: ${bridge.source} → ${bridge.target} via ${bridge.artifact}`,
      });
    }

    // Check that the bridge artifact exists
    const artifactPath = resolve(graph.root, bridge.artifact);
    if (!existsSync(artifactPath)) {
      issues.push({
        severity: "error",
        check: "bridges",
        message: `Bridge artifact not found: ${bridge.artifact}`,
        details: `Expected at ${artifactPath}\nBridge: ${bridge.source} → ${bridge.target}`,
      });
    }

    // Validate cross-ecosystem: source and target should be in different ecosystems
    const sourcePkg = graph.packages.get(bridge.source);
    const targetPkg = graph.packages.get(bridge.target);

    if (sourcePkg && targetPkg && sourcePkg.ecosystem === targetPkg.ecosystem) {
      issues.push({
        severity: "warning",
        check: "bridges",
        message: `Bridge connects packages in the same ecosystem (${sourcePkg.ecosystem}): ${bridge.source} → ${bridge.target}`,
        details:
          "Bridges are intended for cross-ecosystem edges. Intra-ecosystem dependencies should be declared in manifest files.",
      });
    }
  }

  return {
    check: "bridges",
    passed: issues.filter((i) => i.severity === "error").length === 0,
    issues,
    summary:
      issues.length === 0
        ? `${graph.bridges.length} bridge(s) validated`
        : `${issues.length} bridge issue(s) found`,
  };
}
