import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Bridge, WorkspaceGraph, WorkspacePackage } from "@/graph/types";
import type { CheckResult, CheckIssue } from "@/checks/types";

const CHECK_NAME = "staleness";

/**
 * Check whether generated output directories exist for all bridges.
 * All bridges should produce `<source>/generated/<ecosystem>/`.
 *
 * Reports warnings (not errors) — doesn't block pre-commit or CI.
 */
export async function checkStaleness(
  graph: WorkspaceGraph,
  root: string,
): Promise<CheckResult> {
  const issues: CheckIssue[] = [];
  const bridgeOutputs = collectBridgeOutputs(graph.bridges, graph.packages);

  if (bridgeOutputs.length === 0) {
    return {
      check: CHECK_NAME,
      passed: true,
      summary: "no bridge outputs to check",
      issues: [],
    };
  }

  let presentCount = 0;

  for (const output of bridgeOutputs) {
    const generatedDir = join(root, output.source, "generated", output.ecosystem);

    if (existsSync(generatedDir)) {
      presentCount++;
    } else {
      issues.push({
        severity: "warning",
        check: CHECK_NAME,
        message: `${output.source}/generated/${output.ecosystem}/ missing — run \`mido generate\``,
      });
    }
  }

  return {
    check: CHECK_NAME,
    passed: true,
    summary: issues.length > 0
      ? `${issues.length} generated output(s) missing`
      : `${presentCount} generated output(s) present`,
    issues,
  };
}

interface BridgeOutput {
  readonly source: string;
  readonly ecosystem: string;
}

function collectBridgeOutputs(
  bridges: readonly Bridge[],
  packages: ReadonlyMap<string, WorkspacePackage>,
): readonly BridgeOutput[] {
  const seen = new Set<string>();
  const outputs: BridgeOutput[] = [];

  for (const bridge of bridges) {
    for (const consumer of bridge.consumers) {
      const pkg = packages.get(consumer.path);
      if (!pkg) {
        continue;
      }
      const key = `${bridge.source}::${pkg.ecosystem}`;
      if (!seen.has(key)) {
        seen.add(key);
        outputs.push({ source: bridge.source, ecosystem: pkg.ecosystem });
      }
    }
  }

  return outputs;
}
