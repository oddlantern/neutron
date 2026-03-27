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
    const consumerLabel = bridge.consumers.join(", ");

    // Check that source package exists in the graph
    if (!graph.packages.has(bridge.source)) {
      issues.push({
        severity: "error",
        check: "bridges",
        message: `Bridge source package not found in workspace: ${bridge.source}`,
        details: `Declared bridge: ${bridge.source} → [${consumerLabel}] via ${bridge.artifact}`,
      });
    }

    // Check that each consumer package exists in the graph
    for (const consumer of bridge.consumers) {
      if (!graph.packages.has(consumer)) {
        issues.push({
          severity: "error",
          check: "bridges",
          message: `Bridge consumer package not found in workspace: ${consumer}`,
          details: `Declared bridge: ${bridge.source} → [${consumerLabel}] via ${bridge.artifact}`,
        });
      }
    }

    // Check that the bridge artifact exists
    const artifactPath = resolve(graph.root, bridge.artifact);
    if (!existsSync(artifactPath)) {
      issues.push({
        severity: "error",
        check: "bridges",
        message: `Bridge artifact not found: ${bridge.artifact}`,
        details: `Expected at ${artifactPath}\nBridge: ${bridge.source} → [${consumerLabel}]`,
      });
    }

    // Validate cross-ecosystem: warn if any consumer is the same ecosystem as source
    const sourcePkg = graph.packages.get(bridge.source);
    if (sourcePkg) {
      for (const consumer of bridge.consumers) {
        const consumerPkg = graph.packages.get(consumer);
        if (consumerPkg && sourcePkg.ecosystem === consumerPkg.ecosystem) {
          issues.push({
            severity: "warning",
            check: "bridges",
            message: `Bridge connects packages in the same ecosystem (${sourcePkg.ecosystem}): ${bridge.source} → ${consumer}`,
            details:
              "Bridges are intended for cross-ecosystem edges. Intra-ecosystem dependencies should be declared in manifest files.",
          });
        }
      }
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
