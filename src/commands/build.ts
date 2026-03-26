import { loadConfig } from "../config/loader.js";
import { groupByEcosystem } from "./group.js";
import { buildWorkspaceGraph } from "../graph/workspace.js";
import type { ParserRegistry } from "../graph/workspace.js";
import { BOLD, DIM, FAIL, PASS, RESET } from "../output.js";
import { loadPlugins } from "../plugins/loader.js";
import { PluginRegistry } from "../plugins/registry.js";
import { STANDARD_ACTIONS } from "../plugins/types.js";
import { detectPackageManager } from "../pm-detect.js";

const SKIP = `${DIM}·${RESET}`;

export interface BuildOptions {
  readonly quiet?: boolean | undefined;
  readonly package?: string | undefined;
}

/**
 * Run builds across all packages in the workspace.
 *
 * @returns exit code (0 = all built, 1 = build failure)
 */
export async function runBuild(
  parsers: ParserRegistry,
  options: BuildOptions = {},
): Promise<number> {
  const { quiet = false } = options;
  const { config, root } = await loadConfig();
  const graph = await buildWorkspaceGraph(config, root, parsers);
  const plugins = loadPlugins();
  const registry = new PluginRegistry(plugins.ecosystem, plugins.domain);
  const pm = detectPackageManager(root);
  const context = registry.createContext(graph, root, pm);

  const grouped = groupByEcosystem(graph.packages, options);
  let hasErrors = false;
  let builtCount = 0;

  for (const [ecosystem, packages] of grouped) {
    if (!quiet) {
      console.log(
        `\n${DIM}◇${RESET} ${BOLD}${ecosystem}${RESET} ${DIM}(${packages.length} packages)${RESET}`,
      );
    }

    // Build sequentially within an ecosystem (build order may matter)
    for (const pkg of packages) {
      const plugin = registry.getEcosystemForPackage(pkg);
      if (!plugin) {
        if (!quiet) {
          console.log(`  ${SKIP} ${pkg.path} ${DIM}— no plugin${RESET}`);
        }
        continue;
      }

      const actions = await plugin.getActions(pkg, root);
      if (!actions.includes(STANDARD_ACTIONS.BUILD)) {
        if (!quiet) {
          console.log(`  ${SKIP} ${pkg.path} ${DIM}— no build action${RESET}`);
        }
        continue;
      }

      const result = await plugin.execute(STANDARD_ACTIONS.BUILD, pkg, root, context);

      if (!result.success) {
        hasErrors = true;
      } else {
        builtCount++;
      }

      if (quiet && result.success) {
        continue;
      }

      const icon = result.success ? PASS : FAIL;
      const timing =
        result.duration > 0 ? ` ${DIM}(${(result.duration / 1000).toFixed(1)}s)${RESET}` : "";
      console.log(`  ${icon} ${pkg.path}${timing}`);

      if (!result.success && result.output) {
        const trimmed = result.output.trim();
        if (trimmed) {
          const indented = trimmed
            .split("\n")
            .map((line) => `      ${DIM}${line}${RESET}`)
            .join("\n");
          console.log(indented);
        }
      }
    }
  }

  if (!quiet) {
    const icon = hasErrors ? FAIL : PASS;
    console.log(`\n${icon} ${builtCount} package(s) built${hasErrors ? " (with errors)" : ""}\n`);
  }

  return hasErrors ? 1 : 0;
}
