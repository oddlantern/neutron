import { join } from "node:path";

import { loadConfig } from "../config/loader.js";
import { resolveFiles } from "../files/resolver.js";
import { groupByEcosystem } from "./group.js";
import { buildWorkspaceGraph } from "../graph/workspace.js";
import type { ParserRegistry } from "../graph/workspace.js";
import type { WorkspacePackage } from "../graph/types.js";
import { BOLD, DIM, GREEN, RED, RESET } from "../output.js";
import { loadPlugins } from "../plugins/loader.js";
import { PluginRegistry } from "../plugins/registry.js";
import { STANDARD_ACTIONS } from "../plugins/types.js";
import type { ExecuteResult } from "../plugins/types.js";
import { detectPackageManager } from "../watcher/pm-detect.js";

const PASS = `${GREEN}✓${RESET}`;
const FAIL = `${RED}✗${RESET}`;

/** File extensions per ecosystem for lint resolution */
const LINT_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  typescript: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  dart: [".dart"],
};

export interface LintOptions {
  readonly fix?: boolean | undefined;
  readonly quiet?: boolean | undefined;
  readonly package?: string | undefined;
  readonly ecosystem?: string | undefined;
}

interface PackageLintResult {
  readonly pkg: WorkspacePackage;
  readonly result: ExecuteResult;
}

/**
 * Run linters across all packages in the workspace.
 *
 * @returns exit code (0 = no errors, 1 = errors found)
 */
export async function runLint(parsers: ParserRegistry, options: LintOptions = {}): Promise<number> {
  const { fix = false, quiet = false } = options;
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

  const action = fix ? STANDARD_ACTIONS.LINT_FIX : STANDARD_ACTIONS.LINT;

  // Group packages by ecosystem
  const grouped = groupByEcosystem(graph.packages, options);
  let hasErrors = false;

  for (const [ecosystem, packages] of grouped) {
    if (!quiet) {
      console.log(
        `\n${DIM}◇${RESET} ${BOLD}${ecosystem}${RESET} ${DIM}(${packages.length} packages)${RESET}`,
      );
    }

    // Resolve ignore patterns from config
    const ignorePatterns = config.lint?.ignore ?? [];

    // Run all packages in this ecosystem in parallel
    const results: readonly PackageLintResult[] = await Promise.all(
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

        // Resolve files centrally — plugins receive pre-filtered lists
        const extensions = LINT_EXTENSIONS[ecosystem];
        const pkgContext = extensions
          ? {
              ...context,
              resolvedFiles: resolveFiles(join(root, pkg.path), extensions, ignorePatterns),
            }
          : context;

        const result = await plugin.execute(action, pkg, root, pkgContext);
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
    const total = [...grouped.values()].reduce((sum, pkgs) => sum + pkgs.length, 0);
    const icon = hasErrors ? FAIL : PASS;
    console.log(`\n${icon} ${hasErrors ? "Lint errors found" : `All ${total} package(s) clean`}\n`);
  }

  return hasErrors ? 1 : 0;
}
