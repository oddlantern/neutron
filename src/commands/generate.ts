import { existsSync } from "node:fs";
import { join } from "node:path";

import { loadConfig } from "@/config/loader";
import { DiagnosticCollector, formatDiagnostics } from "@/diagnostic";
import { buildWorkspaceGraph } from "@/graph/workspace";
import type { ParserRegistry } from "@/graph/workspace";
import { BOLD, DIM, PASS, RESET } from "@/output";
import { loadPlugins } from "@/plugins/loader";
import { PluginRegistry } from "@/plugins/registry";
import { detectPackageManager } from "@/pm-detect";
import {
  executeBridgeGroup,
  formatMs,
  groupBridgesByArtifact,
  logStep,
  resolveBridges,
} from "@/bridges/runner";
import { isCacheHit, updateCache } from "@/bridges/cache";

export interface GenerateOptions {
  readonly quiet?: boolean | undefined;
  readonly verbose?: boolean | undefined;
  /** Skip cache and regenerate everything */
  readonly force?: boolean | undefined;
  /** Preview changes without writing to disk */
  readonly dryRun?: boolean | undefined;
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
  const { quiet = false, verbose = false, force = false, dryRun = false } = options;
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
  const diag = new DiagnosticCollector();
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
      // Verify output dirs exist — if missing, cache is stale
      const outputMissing = first.targets.some((t) => {
        const genDir = join(root, first.bridge.source, "generated", t.ecosystem);
        return !existsSync(genDir);
      });

      if (cached && !outputMissing) {
        skipped++;
        if (!quiet && verbose) {
          logStep(`${first.bridge.artifact} — cached, skipping`);
        }
        continue;
      }
    }

    try {
      await executeBridgeGroup(group, registry, graph, root, pm, verbose, dryRun, force);
      // Only cache if all expected output dirs were actually created
      const allOutputsExist = group.every((r) =>
        r.targets.every((t) => existsSync(join(root, r.bridge.source, "generated", t.ecosystem))),
      );
      if (allOutputsExist) {
        await updateCache(root, bridgeKey, first.bridge.artifact, first.watchPatterns);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      diag.error(`Bridge failed: ${bridgeKey}`, {
        detail: msg,
        fix: "Check bridge source files and re-run mido generate --force",
      });
    }
  }

  const duration = Math.round(performance.now() - start);
  if (!quiet) {
    const skipNote = skipped > 0 ? ` ${DIM}(${skipped} cached)${RESET}` : "";
    if (!diag.hasErrors) {
      console.log(
        `\n${PASS} ${resolved.length} bridge(s) processed (${formatMs(duration)})${skipNote}`,
      );
    }
    console.log(formatDiagnostics(diag, resolved.length - skipped));
  }

  return diag.hasErrors ? 1 : 0;
}
