import { join } from "node:path";

import { loadConfig } from "../config/loader.js";
import { resolveFiles } from "../files/resolver.js";
import { buildWorkspaceGraph } from "../graph/workspace.js";
import type { ParserRegistry } from "../graph/workspace.js";
import { BOLD, DIM, FAIL, PASS, RESET } from "../output.js";
import { loadPlugins } from "../plugins/loader.js";
import { PluginRegistry } from "../plugins/registry.js";
import type { ExecutionContext } from "../plugins/types.js";
import { detectPackageManager } from "../pm-detect.js";
import type { FilterOptions } from "./group.js";
import { groupByEcosystem } from "./group.js";

/** File extensions per ecosystem for file resolution */
const ECOSYSTEM_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  typescript: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  dart: [".dart"],
};

export interface EcosystemRunnerOptions extends FilterOptions {
  readonly quiet?: boolean | undefined;
}

export interface EcosystemRunnerConfig {
  /** The standard action name to execute */
  readonly action: string;
  /** Config key for ignore patterns ("lint" or "format") */
  readonly ignoreSource: "lint" | "format";
  /** Summary messages: [successMsg, failMsg] */
  readonly summary: readonly [string, string];
}

/**
 * Shared execution engine for lint and format commands.
 * Loads config, builds graph, groups packages by ecosystem,
 * runs the action in parallel per ecosystem, prints results.
 *
 * @returns exit code (0 = success, 1 = errors found)
 */
export async function runEcosystemCommand(
  parsers: ParserRegistry,
  options: EcosystemRunnerOptions,
  runnerConfig: EcosystemRunnerConfig,
): Promise<number> {
  const { quiet = false } = options;
  const { config, root } = await loadConfig();
  const graph = await buildWorkspaceGraph(config, root, parsers);
  const plugins = loadPlugins();
  const registry = new PluginRegistry(plugins.ecosystem, plugins.domain);
  const pm = detectPackageManager(root);
  const context = registry.createContext(
    graph,
    root,
    pm,
    config.lint || config.format
      ? {
          ...(config.lint ? { lintConfig: config.lint } : {}),
          ...(config.format ? { formatConfig: config.format } : {}),
        }
      : undefined,
  );

  const grouped = groupByEcosystem(graph.packages, options);
  let hasErrors = false;

  for (const [ecosystem, packages] of grouped) {
    if (!quiet) {
      console.log(
        `\n${DIM}\u25C7${RESET} ${BOLD}${ecosystem}${RESET} ${DIM}(${packages.length} packages)${RESET}`,
      );
    }

    const ignorePatterns =
      runnerConfig.ignoreSource === "lint"
        ? (config.lint?.ignore ?? [])
        : (config.format?.ignore ?? []);

    const results = await Promise.all(
      packages.map(async (pkg) => {
        const plugin = registry.getEcosystemForPackage(pkg);
        if (!plugin) {
          return {
            pkg,
            result: {
              success: true,
              duration: 0,
              summary: `No plugin for ecosystem ${pkg.ecosystem}`,
            },
          };
        }

        const extensions = ECOSYSTEM_EXTENSIONS[ecosystem];
        const pkgContext: ExecutionContext = extensions
          ? {
              ...context,
              resolvedFiles: resolveFiles(join(root, pkg.path), extensions, ignorePatterns),
            }
          : context;

        const result = await plugin.execute(runnerConfig.action, pkg, root, pkgContext);
        return { pkg, result };
      }),
    );

    for (const { pkg, result } of results) {
      if (!result.success) {
        hasErrors = true;
      }

      if (quiet && result.success) {
        continue;
      }

      const icon = result.success ? PASS : FAIL;
      console.log(`  ${icon} ${pkg.path}`);

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
    const msg = hasErrors ? runnerConfig.summary[1] : runnerConfig.summary[0];
    console.log(`\n${icon} ${msg}\n`);
  }

  return hasErrors ? 1 : 0;
}
