import { join } from "node:path";

import type { Bridge, WorkspaceGraph, WorkspacePackage } from "@/graph/types";
import { BOLD, CYAN, DIM, RESET, YELLOW } from "@/output";
import type { PluginRegistry } from "@/plugins/registry";
import type {
  DomainPlugin,
  EcosystemPlugin,
  ExecutablePipelineStep,
  ExecuteResult,
  PipelineResult,
  PipelineStepResult,
} from "@/plugins/types";
import { runPipeline } from "@/bridges/pipeline";
import {
  formatMs,
  logDebug,
  logFail,
  logOutput,
  logStep,
  logSuccess,
  logUnchanged,
  logWaiting,
} from "@/bridges/logger";

export {
  formatMs,
  logChange,
  logDebug,
  logFail,
  logStep,
  logSuccess,
  logWaiting,
} from "@/bridges/logger";

export interface ResolvedBridge {
  readonly bridge: Bridge;
  readonly watchPatterns: readonly string[];
  readonly domain: DomainPlugin | undefined;
  readonly sourcePlugin: EcosystemPlugin | undefined;
  readonly source: WorkspacePackage;
  readonly targets: readonly WorkspacePackage[];
}

export async function resolveBridges(
  bridges: readonly Bridge[],
  packages: ReadonlyMap<string, WorkspacePackage>,
  registry: PluginRegistry,
  root: string,
): Promise<readonly ResolvedBridge[]> {
  const resolved: ResolvedBridge[] = [];

  for (const bridge of bridges) {
    const source = packages.get(bridge.source);
    if (!source) {
      console.error(`${YELLOW}warn:${RESET} bridge source "${bridge.source}" not found in graph`);
      continue;
    }

    // Resolve all consumers
    const targets: WorkspacePackage[] = [];
    for (const consumer of bridge.consumers) {
      const consumerPkg = packages.get(consumer.path);
      if (!consumerPkg) {
        console.error(
          `${YELLOW}warn:${RESET} bridge consumer "${consumer.path}" not found in graph`,
        );
        continue;
      }
      targets.push(consumerPkg);
    }

    if (targets.length === 0) {
      console.error(`${YELLOW}warn:${RESET} bridge ${bridge.source} has no resolvable consumers`);
      continue;
    }

    const domain = await registry.getDomainForArtifact(bridge.artifact, root);
    const sourcePlugin = registry.getEcosystemForPackage(source);

    let watchPatterns: readonly string[];
    if (bridge.watch?.length) {
      watchPatterns = bridge.watch;
    } else {
      watchPatterns = [join(source.path, "**")];
    }

    resolved.push({
      bridge,
      watchPatterns,
      domain,
      sourcePlugin,
      source,
      targets,
    });
  }

  return resolved;
}

export function printBridgeSummary(
  resolved: readonly ResolvedBridge[],
  registry: PluginRegistry,
): void {
  for (const r of resolved) {
    const artifact = r.bridge.artifact;
    const sourceLabel = r.source.path;
    const targetLabels = r.targets.map((t) => t.path).join(", ");
    const watchLabels = r.watchPatterns.join(", ");

    if (r.domain) {
      const plugins: string[] = [`neutron-${r.domain.name}`];
      if (r.sourcePlugin) {
        plugins.push(`neutron-${r.sourcePlugin.name}`);
      }
      for (const t of r.targets) {
        const eco = registry.getEcosystemForPackage(t);
        if (eco && !plugins.includes(`neutron-${eco.name}`)) {
          plugins.push(`neutron-${eco.name}`);
        }
      }

      console.log(`  ${BOLD}${r.domain.name}:${RESET} ${sourceLabel} \u2192 ${artifact}`);
      console.log(`    ${DIM}watching: ${watchLabels}${RESET}`);
      console.log(`    ${DIM}targets: ${targetLabels}${RESET}`);
      console.log(`    ${DIM}plugins: ${plugins.join(", ")}${RESET}`);
    } else if (r.bridge.run) {
      console.log(`  ${BOLD}bridge:${RESET} ${sourceLabel} \u2192 ${artifact}`);
      console.log(`    ${DIM}watching: ${watchLabels}${RESET}`);
      console.log(`    ${DIM}run: ${r.bridge.run}${RESET}`);
    } else if (r.sourcePlugin) {
      console.log(`  ${BOLD}${r.sourcePlugin.name}:${RESET} ${sourceLabel} \u2192 ${artifact}`);
      console.log(`    ${DIM}watching: ${watchLabels}${RESET}`);
      console.log(`    ${DIM}targets: ${targetLabels}${RESET}`);
    } else {
      console.log(`  ${YELLOW}${BOLD}unmatched:${RESET} ${artifact}`);
      console.log(`    ${YELLOW}No plugin found \u2014 add run: <script> to this bridge${RESET}`);
    }
    console.log();
  }
}

export function printStartup(resolved: readonly ResolvedBridge[], registry: PluginRegistry): void {
  console.log(
    `\n${CYAN}${BOLD}neutron dev${RESET} ${DIM}\u2014 watching ${resolved.length} bridge(s)${RESET}\n`,
  );
  printBridgeSummary(resolved, registry);
  console.log(`  ${DIM}Waiting for changes...${RESET}\n`);
}

function printStepResult(stepResult: PipelineStepResult): void {
  if (!stepResult.success) {
    logFail(
      `${stepResult.step.description.replace(/\.\.\.$/, "")} failed (${formatMs(stepResult.duration)})`,
    );
    if (stepResult.output) {
      logOutput(stepResult.output);
    }
    return;
  }

  if (!stepResult.changed) {
    logUnchanged(`${stepResult.step.description.replace(/\.\.\.$/, "")} \u2014 unchanged`);
    return;
  }

  logSuccess(
    `${stepResult.step.description.replace(/\.\.\.$/, "")} (${formatMs(stepResult.duration)})`,
  );
}

function printResult(result: ExecuteResult, label: string): void {
  if (result.success) {
    logSuccess(`${label}: synced (${formatMs(result.duration)})`);
  } else {
    logFail(`${label}: failed (${formatMs(result.duration)})`);
    if (result.output) {
      logOutput(result.output);
    }
    logWaiting();
  }
}

/**
 * Run a pipeline step-by-step, printing progress as each step completes.
 */
async function runPipelineWithProgress(
  steps: readonly ExecutablePipelineStep[],
  root: string,
): Promise<PipelineResult> {
  const result = await runPipeline(steps, root);

  for (const stepResult of result.steps) {
    printStepResult(stepResult);
  }

  return result;
}

/**
 * Execute a single bridge (no artifact grouping).
 */
async function executeBridge(
  resolved: ResolvedBridge,
  registry: PluginRegistry,
  graph: WorkspaceGraph,
  root: string,
  pm: string,
  verbose: boolean,
  dryRun: boolean = false,
  force: boolean = false,
): Promise<void> {
  const bridge = resolved.bridge;
  const context = registry.createContext(graph, root, pm, { verbose, dryRun, force });

  // Escape hatch: explicit run script
  if (bridge.run && resolved.sourcePlugin) {
    logStep(`running "${bridge.run}" on ${resolved.source.name}...`);
    const result = await resolved.sourcePlugin.execute(bridge.run, resolved.source, root, context);
    printResult(result, `${bridge.source} bridge`);
    return;
  }

  // Domain plugin path — use pipeline if available
  if (resolved.domain) {
    if (resolved.domain.buildPipeline) {
      const steps = await resolved.domain.buildPipeline(
        resolved.source,
        bridge.artifact,
        resolved.targets,
        root,
        context,
      );

      if (steps.length > 0) {
        const pipelineResult = await runPipelineWithProgress(steps, root);

        if (pipelineResult.success) {
          const stepCount = pipelineResult.steps.length;
          logSuccess(
            `${resolved.domain.name} bridge: synced (${formatMs(pipelineResult.totalDuration)}) — ${stepCount} step(s)`,
          );
        } else {
          logWaiting();
        }
        return;
      }
    }

    // Fallback: legacy export + generateDownstream flow
    logStep(`neutron-${resolved.domain.name}: exporting spec...`);
    const exportResult = await resolved.domain.exportArtifact(
      resolved.source,
      bridge.artifact,
      root,
      context,
    );

    if (!exportResult.success) {
      logFail(`export failed (${formatMs(exportResult.duration)})`);
      if (exportResult.output) {
        logOutput(exportResult.output);
      }
      logWaiting();
      return;
    }

    logSuccess(`${bridge.artifact} updated (${formatMs(exportResult.duration)})`);

    if (resolved.targets.length > 0) {
      const downstreamResults = await resolved.domain.generateDownstream(
        bridge.artifact,
        resolved.targets,
        root,
        context,
      );

      let totalDuration = exportResult.duration;
      let allSuccess = true;

      for (const result of downstreamResults) {
        totalDuration += result.duration;
        if (result.success) {
          logSuccess(`${result.summary} (${formatMs(result.duration)})`);
        } else {
          logFail(`${result.summary} (${formatMs(result.duration)})`);
          allSuccess = false;
        }
      }

      if (allSuccess) {
        logSuccess(`${resolved.domain.name} bridge: synced (${formatMs(totalDuration)})`);
      }
    }

    return;
  }

  // Ecosystem-only path
  if (resolved.sourcePlugin) {
    const actions = await resolved.sourcePlugin.getActions(resolved.source, root);
    const action = actions.includes("generate") ? "generate" : actions[0];

    if (!action) {
      logFail(`no actions available for ${resolved.source.name}`);
      logWaiting();
      return;
    }

    logStep(`neutron-${resolved.sourcePlugin.name}: running "${action}"...`);
    const result = await resolved.sourcePlugin.execute(action, resolved.source, root, context);
    printResult(result, `${resolved.source.path} bridge`);
    return;
  }

  logFail(`No plugin found for ${bridge.artifact} — add run: <script> to this bridge`);
  logWaiting();
}

/**
 * Group bridges by artifact path. When multiple bridges share the same artifact
 * and domain plugin, merge their targets and execute once (single validation,
 * parallel generation). Non-grouped bridges execute individually.
 */
export function groupBridgesByArtifact(
  bridges: readonly ResolvedBridge[],
): readonly (readonly ResolvedBridge[])[] {
  const groups = new Map<string, ResolvedBridge[]>();

  for (const bridge of bridges) {
    // Only group bridges that have a domain plugin with buildPipeline
    if (!bridge.domain?.buildPipeline) {
      // Each non-groupable bridge is its own group of 1
      groups.set(`__single__${bridge.bridge.source}__${bridge.bridge.consumers.map((c) => c.path).join(",")}`, [
        bridge,
      ]);
      continue;
    }

    const key = `${bridge.bridge.artifact}::${bridge.domain.name}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(bridge);
    } else {
      groups.set(key, [bridge]);
    }
  }

  return [...groups.values()];
}

/**
 * Execute a group of bridges that share the same artifact.
 * Merges targets from all bridges and runs a single pipeline.
 */
export async function executeBridgeGroup(
  group: readonly ResolvedBridge[],
  registry: PluginRegistry,
  graph: WorkspaceGraph,
  root: string,
  pm: string,
  verbose: boolean,
  dryRun: boolean = false,
  force: boolean = false,
): Promise<void> {
  const first = group[0];
  if (!first) {
    return;
  }

  // Single bridge — no grouping needed
  if (group.length === 1) {
    await executeBridge(first, registry, graph, root, pm, verbose, dryRun, force);
    return;
  }

  // Multiple bridges sharing the same artifact — merge targets
  const domain = first.domain;

  if (!domain?.buildPipeline) {
    // Shouldn't happen (groupBridgesByArtifact only groups these), but handle gracefully
    for (const bridge of group) {
      await executeBridge(bridge, registry, graph, root, pm, verbose, dryRun, force);
    }
    return;
  }

  const mergedTargets: WorkspacePackage[] = [];
  for (const bridge of group) {
    mergedTargets.push(...bridge.targets);
  }

  const context = registry.createContext(graph, root, pm, { verbose, dryRun, force });

  if (verbose) {
    const targetNames = mergedTargets.map((t) => t.path).join(", ");
    logDebug(
      `grouped ${group.length} bridges for artifact ${first.bridge.artifact} → [${targetNames}]`,
    );
  }

  const steps = await domain.buildPipeline(
    first.source,
    first.bridge.artifact,
    mergedTargets,
    root,
    context,
  );

  if (steps.length > 0) {
    const pipelineResult = await runPipelineWithProgress(steps, root);

    if (pipelineResult.success) {
      const stepCount = pipelineResult.steps.length;
      logSuccess(
        `${domain.name} bridge: synced (${formatMs(pipelineResult.totalDuration)}) — ${stepCount} step(s)`,
      );
    } else {
      logWaiting();
    }
    return;
  }

  // Fallback if buildPipeline returned no steps
  for (const bridge of group) {
    await executeBridge(bridge, registry, graph, root, pm, verbose, dryRun, force);
  }
}

export function matchesBridge(relPath: string, bridge: ResolvedBridge): boolean {
  for (const pattern of bridge.watchPatterns) {
    // Strip glob suffix to get the directory prefix
    const patternBase = pattern.replace(/\/?\*\*.*$/, "");
    if (patternBase && relPath.startsWith(patternBase)) {
      return true;
    }
  }
  return false;
}
