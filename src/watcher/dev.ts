import { join, relative } from "node:path";

import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";

import { writeHooks } from "../hooks.js";
import { loadConfig } from "../config/loader.js";
import { buildWorkspaceGraph } from "../graph/workspace.js";
import type { ParserRegistry } from "../graph/workspace.js";
import type { WorkspaceGraph } from "../graph/types.js";
import { DIM, RED, RESET, YELLOW } from "../output.js";
import { loadPlugins } from "../plugins/loader.js";
import { PluginRegistry } from "../plugins/registry.js";
import { detectPackageManager } from "../pm-detect.js";
import {
  executeBridgeGroup,
  groupBridgesByArtifact,
  logChange,
  logDebug,
  logFail,
  logStep,
  logWaiting,
  matchesBridge,
  printBridgeSummary,
  printStartup,
  resolveBridges,
} from "./bridge-runner.js";
import type { ResolvedBridge } from "./bridge-runner.js";
import { createDebouncer } from "./debouncer.js";
import type { Debouncer } from "./debouncer.js";

const CONFIG_FILENAME = "mido.yml";
const CONFIG_RELOAD_DEBOUNCE_MS = 500;
const CHOKIDAR_STABILITY_THRESHOLD_MS = 300;
const CHOKIDAR_POLL_INTERVAL_MS = 100;

export interface DevOptions {
  readonly verbose?: boolean | undefined;
}

/** Mutable state for the running watcher session */
interface WatcherSession {
  readonly watcher: FSWatcher;
  readonly bridgeDebouncers: Map<ResolvedBridge, Debouncer>;
  readonly configDebouncer: Debouncer;
  readonly resolved: readonly ResolvedBridge[];
  readonly graph: WorkspaceGraph;
  readonly registry: PluginRegistry;
  readonly root: string;
  readonly pm: string;
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
    const pending: Set<ResolvedBridge> = new Set();

    async function processPending(): Promise<void> {
      if (running) {
        return;
      }
      running = true;

      while (pending.size > 0) {
        const batch = [...pending];
        pending.clear();

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
          logDebug(
            `debouncer fired for bridge: ${r.bridge.source} \u2192 [${r.bridge.consumers.join(", ")}]`,
          );
        }
        pending.add(r);
        processPending();
      });
      bridgeDebouncers.set(r, debouncer);
    }

    // Config reload debouncer — fires when mido.yml changes
    const configDebouncer = createDebouncer(async () => {
      logStep("mido.yml changed \u2014 validating...");

      // Validate config before tearing down the current session
      try {
        await loadConfig();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logFail(`Invalid config — keeping current session: ${msg}`);
        logWaiting();
        return;
      }

      logStep("config valid \u2014 reloading...");

      if (session) {
        teardownSession(session);
      }

      try {
        const newSession = await startSession();
        if (newSession) {
          session = newSession;

          // Regenerate hooks from updated config (non-interactive)
          const { config, root: cfgRoot } = await loadConfig();
          await writeHooks(cfgRoot, config, false);

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
    }, CONFIG_RELOAD_DEBOUNCE_MS);

    // Start chokidar watcher
    const watcher = chokidar.watch(allWatchPaths, {
      ignoreInitial: true,
      ignored: [
        "**/node_modules/**",
        "**/.dart_tool/**",
        "**/build/**",
        "**/dist/**",
        "**/.symlinks/**",
        "**/generated/**",
      ],
      awaitWriteFinish: {
        stabilityThreshold: CHOKIDAR_STABILITY_THRESHOLD_MS,
        pollInterval: CHOKIDAR_POLL_INTERVAL_MS,
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
              `  matched bridge: ${r.bridge.source} \u2192 [${r.bridge.consumers.join(", ")}] (triggering debouncer)`,
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

  // Background outdated check (non-blocking)
  import("../commands/outdated.js")
    .then(({ quickOutdatedCheck }) => quickOutdatedCheck(parsers))
    .then((msg) => {
      if (msg) {
        console.log(`  ${YELLOW}${msg}${RESET}\n`);
      }
    })
    .catch(() => {
      // Silently ignore — network may be unavailable
    });

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
