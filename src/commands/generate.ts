import { loadConfig } from "../config/loader.js";
import { buildWorkspaceGraph } from "../graph/workspace.js";
import type { ParserRegistry } from "../graph/workspace.js";
import { BOLD, DIM, FAIL, PASS, RESET } from "../output.js";
import { loadPlugins } from "../plugins/loader.js";
import { PluginRegistry } from "../plugins/registry.js";
import { detectPackageManager } from "../pm-detect.js";
import {
  executeBridgeGroup,
  formatMs,
  groupBridgesByArtifact,
  logStep,
  resolveBridges,
} from "../watcher/bridge-runner.js";
import { isCacheHit, updateCache } from "../watcher/pipeline-cache.js";

export interface GenerateOptions {
  readonly quiet?: boolean | undefined;
  readonly verbose?: boolean | undefined;
  /** Skip cache and regenerate everything */
  readonly force?: boolean | undefined;
}

/**
 * Run all bridge pipelines to generate artifacts.
 *
 * Uses an input hash cache to skip unchanged bridges. Pass --force to regenerate everything.
 *
 * @returns exit code (0 = all generated, 1 = failure)
 */
export async function runGenerate(
  parsers: ParserRegistry,
  options: GenerateOptions = {},
): Promise<number> {
  const { quiet = false, verbose = false, force = false } = options;
  const { config, root } = await loadConfig();
  const graph = await buildWorkspaceGraph(config, root, parsers);
  const plugins = loadPlugins();
  const registry = new PluginRegistry(plugins.ecosystem, plugins.domain);
  const pm = detectPackageManager(root);

  const bridges = config.bridges ?? [];
  if (bridges.length === 0) {
    if (!quiet) {
      console.log(`${DIM}No bridges configured — nothing to generate.${RESET}`);
    }
    return 0;
  }

  const resolved = await resolveBridges(bridges, graph.packages, registry, root);
  if (resolved.length === 0) {
    if (!quiet) {
      console.log(`${DIM}No resolvable bridges found.${RESET}`);
    }
    return 0;
  }

  if (!quiet) {
    console.log(
      `\n${BOLD}mido generate${RESET} ${DIM}— ${resolved.length} bridge(s)${RESET}\n`,
    );
  }

  const groups = groupBridgesByArtifact(resolved);
  let hasErrors = false;
  let skipped = 0;
  const start = performance.now();

  for (const group of groups) {
    const first = group[0];
    if (!first) {
      continue;
    }

    const bridgeKey = `${first.bridge.source}::${first.bridge.artifact}`;

    // Check cache unless --force
    if (!force) {
      const cached = await isCacheHit(
        root,
        bridgeKey,
        first.bridge.artifact,
        first.watchPatterns,
      );
      if (cached) {
        skipped++;
        if (!quiet && verbose) {
          logStep(`${first.bridge.artifact} — cached, skipping`);
        }
        continue;
      }
    }

    try {
      await executeBridgeGroup(group, registry, graph, root, pm, verbose);
      // Update cache on success
      await updateCache(root, bridgeKey, first.bridge.artifact, first.watchPatterns);
    } catch (err: unknown) {
      hasErrors = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${FAIL} ${msg}`);
    }
  }

  const duration = Math.round(performance.now() - start);
  if (!quiet) {
    const icon = hasErrors ? FAIL : PASS;
    const skipNote = skipped > 0 ? ` ${DIM}(${skipped} cached)${RESET}` : "";
    console.log(
      `\n${icon} ${resolved.length} bridge(s) processed (${formatMs(duration)})${hasErrors ? " (with errors)" : ""}${skipNote}\n`,
    );
  }

  return hasErrors ? 1 : 0;
}
