import { join, relative } from "node:path";

import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";

import { loadConfig } from "../config/loader.js";
import { buildWorkspaceGraph } from "../graph/workspace.js";
import type { ParserRegistry } from "../graph/workspace.js";
import type { Bridge, WorkspaceGraph, WorkspacePackage } from "../graph/types.js";
import { BOLD, CYAN, DIM, GREEN, RED, RESET, YELLOW } from "../output.js";
import { loadPlugins } from "../plugins/loader.js";
import { PluginRegistry } from "../plugins/registry.js";
import type {
  DomainPlugin,
  EcosystemPlugin,
  ExecutablePipelineStep,
  ExecuteResult,
  PipelineResult,
  PipelineStepResult,
} from "../plugins/types.js";
import { detectPackageManager } from "./pm-detect.js";
import { createDebouncer } from "./debouncer.js";
import type { Debouncer } from "./debouncer.js";
import { runPipeline } from "./pipeline.js";

const MAGENTA = "\x1b[35m";
const CONFIG_FILENAME = "mido.yml";

interface ResolvedBridge {
  readonly bridge: Bridge;
  readonly watchPatterns: readonly string[];
  readonly domain: DomainPlugin | undefined;
  readonly sourcePlugin: EcosystemPlugin | undefined;
  readonly source: WorkspacePackage;
  readonly targets: readonly WorkspacePackage[];
}

export interface DevOptions {
  readonly verbose?: boolean | undefined;
}

/** Mutable state for the running watcher session */
interface WatcherSession {
  watcher: FSWatcher;
  bridgeDebouncers: Map<ResolvedBridge, Debouncer>;
  configDebouncer: Debouncer;
  resolved: readonly ResolvedBridge[];
  graph: WorkspaceGraph;
  registry: PluginRegistry;
  root: string;
  pm: string;
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function log(icon: string, message: string): void {
  console.log(`  ${icon} ${message}`);
}

function logStep(message: string): void {
  log(`${DIM}\u25C7${RESET}`, `${DIM}${message}${RESET}`);
}

function logSuccess(message: string): void {
  log(`${GREEN}\u2713${RESET}`, `${GREEN}${message}${RESET}`);
}

function logFail(message: string): void {
  log(`${RED}\u2717${RESET}`, `${RED}${message}${RESET}`);
}

function logChange(path: string): void {
  log(`${CYAN}\u25CB${RESET}`, `changes in ${DIM}${path}${RESET}`);
}

function logWaiting(): void {
  log(`${DIM}\u2298${RESET}`, `${DIM}waiting for next change...${RESET}`);
}

function logUnchanged(message: string): void {
  log(`${DIM}\u00B7${RESET}`, `${DIM}${message}${RESET}`);
}

function logOutput(output: string): void {
  const lines = output.trim().split("\n");
  const MAX_OUTPUT_LINES = 15;
  const shown = lines.slice(0, MAX_OUTPUT_LINES);
  for (const line of shown) {
    console.log(`    ${DIM}${line}${RESET}`);
  }
  if (lines.length > MAX_OUTPUT_LINES) {
    console.log(`    ${DIM}... ${lines.length - MAX_OUTPUT_LINES} more line(s)${RESET}`);
  }
}

function logDebug(message: string): void {
  console.log(`  ${MAGENTA}[verbose]${RESET} ${DIM}${message}${RESET}`);
}

async function resolveBridges(
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

    const target = packages.get(bridge.target);
    if (!target) {
      console.error(`${YELLOW}warn:${RESET} bridge target "${bridge.target}" not found in graph`);
      continue;
    }

    const domain = await registry.getDomainForArtifact(bridge.artifact, root);
    const sourcePlugin = registry.getEcosystemForPackage(source);

    // Resolve watch patterns — explicit config takes priority, otherwise
    // fall back to the source package directory. Note: the default watches
    // the source package root, which may be wrong when the actual trigger
    // files live in a different package (e.g., apps/server routes that
    // packages/api exports as an OpenAPI spec). In those cases, the user
    // must set watch paths explicitly in mido.yml.
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
      targets: [target],
    });
  }

  return resolved;
}

function printBridgeSummary(resolved: readonly ResolvedBridge[], registry: PluginRegistry): void {
  for (const r of resolved) {
    const artifact = r.bridge.artifact;
    const sourceLabel = r.source.path;
    const targetLabels = r.targets.map((t) => t.path).join(", ");
    const watchLabels = r.watchPatterns.join(", ");

    if (r.domain) {
      const plugins: string[] = [`mido-${r.domain.name}`];
      if (r.sourcePlugin) {
        plugins.push(`mido-${r.sourcePlugin.name}`);
      }
      for (const t of r.targets) {
        const eco = registry.getEcosystemForPackage(t);
        if (eco && !plugins.includes(`mido-${eco.name}`)) {
          plugins.push(`mido-${eco.name}`);
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

function printStartup(resolved: readonly ResolvedBridge[], registry: PluginRegistry): void {
  console.log(
    `\n${CYAN}${BOLD}mido dev${RESET} ${DIM}\u2014 watching ${resolved.length} bridge(s)${RESET}\n`,
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
): Promise<void> {
  const bridge = resolved.bridge;
  const context = registry.createContext(graph, root, pm, { verbose });

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
    logStep(`mido-${resolved.domain.name}: exporting spec...`);
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

    logStep(`mido-${resolved.sourcePlugin.name}: running "${action}"...`);
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
function groupBridgesByArtifact(
  bridges: readonly ResolvedBridge[],
): readonly (readonly ResolvedBridge[])[] {
  const groups = new Map<string, ResolvedBridge[]>();

  for (const bridge of bridges) {
    // Only group bridges that have a domain plugin with buildPipeline
    if (!bridge.domain?.buildPipeline) {
      // Each non-groupable bridge is its own group of 1
      groups.set(`__single__${bridge.bridge.source}__${bridge.bridge.target}`, [bridge]);
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
async function executeBridgeGroup(
  group: readonly ResolvedBridge[],
  registry: PluginRegistry,
  graph: WorkspaceGraph,
  root: string,
  pm: string,
  verbose: boolean,
): Promise<void> {
  const first = group[0];
  if (!first) {
    return;
  }

  // Single bridge — no grouping needed
  if (group.length === 1) {
    await executeBridge(first, registry, graph, root, pm, verbose);
    return;
  }

  // Multiple bridges sharing the same artifact — merge targets
  const domain = first.domain;

  if (!domain?.buildPipeline) {
    // Shouldn't happen (groupBridgesByArtifact only groups these), but handle gracefully
    for (const bridge of group) {
      await executeBridge(bridge, registry, graph, root, pm, verbose);
    }
    return;
  }

  const mergedTargets: WorkspacePackage[] = [];
  for (const bridge of group) {
    mergedTargets.push(...bridge.targets);
  }

  const context = registry.createContext(graph, root, pm, { verbose });

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
    await executeBridge(bridge, registry, graph, root, pm, verbose);
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

function matchesBridge(relPath: string, bridge: ResolvedBridge): boolean {
  for (const pattern of bridge.watchPatterns) {
    // Strip glob suffix to get the directory prefix
    const patternBase = pattern.replace(/\/?\*\*.*$/, "");
    if (patternBase && relPath.startsWith(patternBase)) {
      return true;
    }
  }
  return false;
}

/** Resolve watch patterns to base directories for chokidar */
function resolveWatchDirs(resolved: readonly ResolvedBridge[], root: string): readonly string[] {
  const watchDirs = new Set<string>();
  for (const r of resolved) {
    for (const pattern of r.watchPatterns) {
      const baseDir = pattern.replace(/\/?\*\*.*$/, "") || ".";
      watchDirs.add(join(root, baseDir));
    }
  }
  return [...watchDirs];
}

/** Tear down an existing watcher session */
function teardownSession(session: WatcherSession): void {
  for (const debouncer of session.bridgeDebouncers.values()) {
    debouncer.cancel();
  }
  session.configDebouncer.cancel();
  session.watcher.close();
}

/**
 * Run the mido dev watcher daemon.
 *
 * Loads config, builds graph, discovers plugins, watches files,
 * and re-runs bridge pipelines on changes. Watches mido.yml and
 * reloads everything when the config changes.
 */
export async function runDev(parsers: ParserRegistry, options: DevOptions = {}): Promise<number> {
  const verbose = options.verbose ?? false;

  let session: WatcherSession | undefined;

  async function startSession(): Promise<WatcherSession | undefined> {
    const { config, root } = await loadConfig();
    const graph = await buildWorkspaceGraph(config, root, parsers);
    const pm = detectPackageManager(root);

    if (verbose) {
      logDebug(`workspace root: ${root}`);
      logDebug(`package manager: ${pm}`);
      logDebug(`packages in graph: ${graph.packages.size}`);
    }

    const { ecosystem, domain } = loadPlugins();
    const registry = new PluginRegistry(ecosystem, domain);

    if (graph.bridges.length === 0) {
      console.error(`${YELLOW}warn:${RESET} No bridges defined in mido.yml. Nothing to watch.`);
      return undefined;
    }

    const resolved = await resolveBridges(graph.bridges, graph.packages, registry, root);
    if (resolved.length === 0) {
      console.error(`${RED}error:${RESET} No bridges could be resolved.`);
      return undefined;
    }

    // Resolve watch dirs for bridges + mido.yml itself
    const bridgeWatchDirs = resolveWatchDirs(resolved, root);
    const configPath = join(root, CONFIG_FILENAME);
    const allWatchPaths = [...bridgeWatchDirs, configPath];

    if (verbose) {
      logDebug(`chokidar watching ${allWatchPaths.length} path(s):`);
      for (const p of allWatchPaths) {
        logDebug(`  ${p}`);
      }
    }

    // Track running state to prevent overlapping executions
    let running = false;
    let pending: Set<ResolvedBridge> = new Set();

    async function processPending(): Promise<void> {
      if (running) {
        return;
      }
      running = true;

      while (pending.size > 0) {
        const batch = [...pending];
        pending = new Set();

        // Group bridges that share the same artifact for single-validation execution
        const groups = groupBridgesByArtifact(batch);
        for (const group of groups) {
          await executeBridgeGroup(group, registry, graph, root, pm, verbose);
        }
      }

      running = false;
    }

    // Create per-bridge debouncers
    const bridgeDebouncers = new Map<ResolvedBridge, Debouncer>();
    for (const r of resolved) {
      const debouncer = createDebouncer(() => {
        if (verbose) {
          logDebug(`debouncer fired for bridge: ${r.bridge.source} \u2192 ${r.bridge.target}`);
        }
        pending.add(r);
        processPending();
      });
      bridgeDebouncers.set(r, debouncer);
    }

    // Config reload debouncer — fires when mido.yml changes
    const configDebouncer = createDebouncer(async () => {
      logStep("mido.yml changed \u2014 reloading config...");

      if (session) {
        teardownSession(session);
      }

      try {
        const newSession = await startSession();
        if (newSession) {
          session = newSession;
          console.log();
          printBridgeSummary(newSession.resolved, newSession.registry);
          console.log(`  ${DIM}Waiting for changes...${RESET}\n`);
        } else {
          logFail("Config reload failed \u2014 no valid bridges. Fix mido.yml and save again.");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logFail(`Config reload failed: ${msg}`);
        logWaiting();
      }
    }, 500);

    // Start chokidar watcher
    const watcher = chokidar.watch(allWatchPaths, {
      ignoreInitial: true,
      ignored: [
        "**/node_modules/**",
        "**/.dart_tool/**",
        "**/build/**",
        "**/dist/**",
        "**/.symlinks/**",
      ],
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    if (verbose) {
      watcher.on("ready", () => {
        logDebug("chokidar ready \u2014 watcher initialized");
        const watched = watcher.getWatched();
        let fileCount = 0;
        for (const files of Object.values(watched)) {
          fileCount += files.length;
        }
        logDebug(`chokidar tracking ${Object.keys(watched).length} dir(s), ${fileCount} file(s)`);
      });
    }

    function handleFileEvent(event: string, filePath: string): void {
      const relPath = relative(root, filePath);

      if (verbose) {
        logDebug(`chokidar ${event}: ${filePath}`);
      }

      // Check if it's the config file
      if (relPath === CONFIG_FILENAME) {
        if (verbose) {
          logDebug("config file changed \u2014 scheduling reload");
        }
        configDebouncer.trigger();
        return;
      }

      logChange(relPath);

      let matched = false;
      for (const r of resolved) {
        if (matchesBridge(relPath, r)) {
          matched = true;
          if (verbose) {
            logDebug(
              `  matched bridge: ${r.bridge.source} \u2192 ${r.bridge.target} (triggering debouncer)`,
            );
          }
          const debouncer = bridgeDebouncers.get(r);
          if (debouncer) {
            debouncer.trigger();
          }
        }
      }

      if (verbose && !matched) {
        logDebug(`  no bridge matched for ${relPath}`);
      }
    }

    watcher.on("change", (path: string) => handleFileEvent("change", path));
    watcher.on("add", (path: string) => handleFileEvent("add", path));
    watcher.on("unlink", (path: string) => {
      if (verbose) {
        logDebug(`chokidar unlink: ${path}`);
      }
    });

    return {
      watcher,
      bridgeDebouncers,
      configDebouncer,
      resolved,
      graph,
      registry,
      root,
      pm,
    };
  }

  // Initial startup
  session = await startSession();
  if (!session) {
    return 1;
  }

  printStartup(session.resolved, session.registry);

  // Handle graceful shutdown
  return new Promise<number>((resolve) => {
    const cleanup = (): void => {
      console.log(`\n  ${DIM}Shutting down...${RESET}`);
      if (session) {
        teardownSession(session);
      }
      resolve(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  });
}
