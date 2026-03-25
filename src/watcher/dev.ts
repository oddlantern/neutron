import { join, relative } from 'node:path';

import chokidar from 'chokidar';

import { loadConfig } from '../config/loader.js';
import { buildWorkspaceGraph } from '../graph/workspace.js';
import type { ParserRegistry } from '../graph/workspace.js';
import type { Bridge, WorkspaceGraph, WorkspacePackage } from '../graph/types.js';
import { BOLD, CYAN, DIM, GREEN, RED, RESET, YELLOW } from '../output.js';
import { loadPlugins } from '../plugins/loader.js';
import { PluginRegistry } from '../plugins/registry.js';
import type { DomainPlugin, EcosystemPlugin, ExecuteResult } from '../plugins/types.js';
import { detectPackageManager } from './pm-detect.js';
import { createDebouncer } from './debouncer.js';

interface ResolvedBridge {
  readonly bridge: Bridge;
  readonly watchPatterns: readonly string[];
  readonly domain: DomainPlugin | undefined;
  readonly sourcePlugin: EcosystemPlugin | undefined;
  readonly source: WorkspacePackage;
  readonly targets: readonly WorkspacePackage[];
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

function logOutput(output: string): void {
  const trimmed = output.trim().split('\n').slice(0, 5);
  for (const line of trimmed) {
    console.log(`    ${DIM}${line}${RESET}`);
  }
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

    // Resolve watch patterns
    let watchPatterns: readonly string[];
    if (bridge.watch?.length) {
      watchPatterns = bridge.watch;
    } else if (sourcePlugin) {
      const patterns = await sourcePlugin.getWatchPatterns(source, root);
      watchPatterns = patterns.map((p) => join(source.path, p));
    } else {
      watchPatterns = [join(source.path, '**/*')];
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

function printStartup(
  resolved: readonly ResolvedBridge[],
  registry: PluginRegistry,
): void {
  console.log(
    `\n${CYAN}${BOLD}mido dev${RESET} ${DIM}\u2014 watching ${resolved.length} bridge(s)${RESET}\n`,
  );

  for (const r of resolved) {
    const artifact = r.bridge.artifact;
    const sourceLabel = r.source.path;
    const targetLabels = r.targets.map((t) => t.path).join(', ');

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
      console.log(`    ${DIM}targets: ${targetLabels}${RESET}`);
      console.log(`    ${DIM}plugins: ${plugins.join(', ')}${RESET}`);
    } else if (r.bridge.run) {
      console.log(`  ${BOLD}bridge:${RESET} ${sourceLabel} \u2192 ${artifact}`);
      console.log(`    ${DIM}run: ${r.bridge.run}${RESET}`);
    } else if (r.sourcePlugin) {
      console.log(`  ${BOLD}${r.sourcePlugin.name}:${RESET} ${sourceLabel} \u2192 ${artifact}`);
      console.log(`    ${DIM}targets: ${targetLabels}${RESET}`);
    } else {
      console.log(
        `  ${YELLOW}${BOLD}unmatched:${RESET} ${artifact}`,
      );
      console.log(
        `    ${YELLOW}No plugin found \u2014 add run: <script> to this bridge${RESET}`,
      );
    }
    console.log();
  }

  console.log(`  ${DIM}Waiting for changes...${RESET}\n`);
}

async function executeBridge(
  resolved: ResolvedBridge,
  registry: PluginRegistry,
  graph: WorkspaceGraph,
  root: string,
  pm: string,
): Promise<void> {
  const bridge = resolved.bridge;
  const context = registry.createContext(graph, root, pm);

  // Escape hatch: explicit run script
  if (bridge.run && resolved.sourcePlugin) {
    logStep(`running "${bridge.run}" on ${resolved.source.name}...`);
    const result = await resolved.sourcePlugin.execute(
      bridge.run,
      resolved.source,
      root,
      context,
    );
    printResult(result, `${bridge.source} bridge`);
    return;
  }

  // Domain plugin path
  if (resolved.domain) {
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

    // Generate downstream
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
        logSuccess(
          `${resolved.domain.name} bridge: synced (${formatMs(totalDuration)})`,
        );
      }
    }

    return;
  }

  // Ecosystem-only path
  if (resolved.sourcePlugin) {
    const actions = await resolved.sourcePlugin.getActions(resolved.source, root);
    const action = actions.includes('generate')
      ? 'generate'
      : actions[0];

    if (!action) {
      logFail(`no actions available for ${resolved.source.name}`);
      logWaiting();
      return;
    }

    logStep(`mido-${resolved.sourcePlugin.name}: running "${action}"...`);
    const result = await resolved.sourcePlugin.execute(
      action,
      resolved.source,
      root,
      context,
    );
    printResult(result, `${resolved.source.path} bridge`);
    return;
  }

  logFail(
    `No plugin found for ${bridge.artifact} \u2014 add run: <script> to this bridge`,
  );
  logWaiting();
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
    const patternBase = pattern.replace(/\*\*.*/, '');
    if (relPath.startsWith(patternBase) || pattern.includes('**')) {
      return true;
    }
  }
  return false;
}

/**
 * Run the mido dev watcher daemon.
 *
 * Loads config, builds graph, discovers plugins, watches files,
 * and re-runs bridge pipelines on changes.
 */
export async function runDev(parsers: ParserRegistry): Promise<number> {
  const { config, root } = await loadConfig();
  const graph = await buildWorkspaceGraph(config, root, parsers);
  const pm = detectPackageManager(root);

  const { ecosystem, domain } = loadPlugins();
  const registry = new PluginRegistry(ecosystem, domain);

  if (graph.bridges.length === 0) {
    console.error(
      `${YELLOW}warn:${RESET} No bridges defined in mido.yml. Nothing to watch.`,
    );
    return 1;
  }

  const resolved = await resolveBridges(graph.bridges, graph.packages, registry, root);
  if (resolved.length === 0) {
    console.error(`${RED}error:${RESET} No bridges could be resolved.`);
    return 1;
  }

  printStartup(resolved, registry);

  // Collect all watch patterns
  const allPatterns: string[] = [];
  for (const r of resolved) {
    for (const pattern of r.watchPatterns) {
      allPatterns.push(join(root, pattern));
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

      for (const item of batch) {
        await executeBridge(item, registry, graph, root, pm);
      }
    }

    running = false;
  }

  // Create per-bridge debouncers
  const bridgeDebouncers = new Map<ResolvedBridge, ReturnType<typeof createDebouncer>>();
  for (const r of resolved) {
    const debouncer = createDebouncer(() => {
      pending.add(r);
      processPending();
    });
    bridgeDebouncers.set(r, debouncer);
  }

  // Start chokidar watcher
  const watcher = chokidar.watch(allPatterns, {
    ignoreInitial: true,
    ignored: [
      '**/node_modules/**',
      '**/.dart_tool/**',
      '**/build/**',
      '**/dist/**',
      '**/.symlinks/**',
    ],
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  function handleFileEvent(filePath: string): void {
    const relPath = relative(root, filePath);
    logChange(relPath);

    for (const r of resolved) {
      if (matchesBridge(relPath, r)) {
        const debouncer = bridgeDebouncers.get(r);
        if (debouncer) {
          debouncer.trigger();
        }
      }
    }
  }

  watcher.on('change', handleFileEvent);
  watcher.on('add', handleFileEvent);

  // Handle graceful shutdown — resolve the promise instead of process.exit
  return new Promise<number>((resolve) => {
    const cleanup = (): void => {
      console.log(`\n  ${DIM}Shutting down...${RESET}`);
      for (const debouncer of bridgeDebouncers.values()) {
        debouncer.cancel();
      }
      watcher.close();
      resolve(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });
}
