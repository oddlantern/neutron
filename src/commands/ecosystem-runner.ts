import { join } from "node:path";

import { loadConfig } from "@/config/loader";
import { DiagnosticCollector, formatDiagnostics } from "@/diagnostic";
import { resolveFiles } from "@/files/resolver";
import { buildWorkspaceGraph } from "@/graph/workspace";
import type { ParserRegistry } from "@/graph/workspace";
import { BOLD, DIM, FAIL, PASS, RESET } from "@/output";
import { loadPlugins } from "@/plugins/loader";
import { PluginRegistry } from "@/plugins/registry";
import type { ExecutionContext } from "@/plugins/types";
import { detectPackageManager } from "@/pm-detect";
import type { FilterOptions } from "@/commands/group";
import { groupByEcosystem } from "@/commands/group";

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
  const diag = new DiagnosticCollector();

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
        const firstLine = result.output?.trim().split("\n")[0] ?? "";
        diag.error(`${runnerConfig.action} failed: ${pkg.path}`, {
          detail: firstLine,
        });
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

  if (!quiet || diag.hasIssues) {
    console.log(formatDiagnostics(diag));
  }

  return diag.hasErrors ? 1 : 0;
}
