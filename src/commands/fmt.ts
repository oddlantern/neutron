import { loadConfig } from '../config/loader.js';
import { buildWorkspaceGraph } from '../graph/workspace.js';
import type { ParserRegistry } from '../graph/workspace.js';
import type { WorkspacePackage } from '../graph/types.js';
import { BOLD, DIM, GREEN, RED, RESET } from '../output.js';
import { loadPlugins } from '../plugins/loader.js';
import { PluginRegistry } from '../plugins/registry.js';
import { STANDARD_ACTIONS } from '../plugins/types.js';
import type { ExecuteResult } from '../plugins/types.js';
import { detectPackageManager } from '../watcher/pm-detect.js';

const PASS = `${GREEN}✓${RESET}`;
const FAIL = `${RED}✗${RESET}`;

export interface FmtOptions {
  readonly check?: boolean | undefined;
  readonly quiet?: boolean | undefined;
  readonly package?: string | undefined;
  readonly ecosystem?: string | undefined;
}

interface PackageFmtResult {
  readonly pkg: WorkspacePackage;
  readonly result: ExecuteResult;
}

/**
 * Run formatting across all packages in the workspace.
 *
 * @returns exit code (0 = all formatted, 1 = unformatted files found in check mode)
 */
export async function runFmt(parsers: ParserRegistry, options: FmtOptions = {}): Promise<number> {
  const { check = false, quiet = false } = options;
  const { config, root } = await loadConfig();
  const graph = await buildWorkspaceGraph(config, root, parsers);
  const plugins = loadPlugins();
  const registry = new PluginRegistry(plugins.ecosystem, plugins.domain);
  const pm = detectPackageManager(root);
  const context = registry.createContext(graph, root, pm);

  const action = check ? STANDARD_ACTIONS.FORMAT_CHECK : STANDARD_ACTIONS.FORMAT;

  const grouped = groupByEcosystem(graph.packages, options);
  let hasErrors = false;

  for (const [ecosystem, packages] of grouped) {
    if (!quiet) {
      console.log(
        `\n${DIM}◇${RESET} ${BOLD}${ecosystem}${RESET} ${DIM}(${packages.length} packages)${RESET}`,
      );
    }

    const results: readonly PackageFmtResult[] = await Promise.all(
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
        const result = await plugin.execute(action, pkg, root, context);
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
            .split('\n')
            .map((line) => `      ${DIM}${line}${RESET}`)
            .join('\n');
          console.log(indented);
        }
      }
    }
  }

  if (!quiet) {
    const icon = hasErrors ? FAIL : PASS;
    const msg = check
      ? hasErrors
        ? 'Formatting issues found'
        : 'All files formatted'
      : hasErrors
        ? 'Formatting failed'
        : 'All formatted';
    console.log(`\n${icon} ${msg}\n`);
  }

  return hasErrors ? 1 : 0;
}

/** Group packages by ecosystem, applying filters */
function groupByEcosystem(
  packages: ReadonlyMap<string, WorkspacePackage>,
  options: FmtOptions,
): Map<string, WorkspacePackage[]> {
  const grouped = new Map<string, WorkspacePackage[]>();

  for (const pkg of packages.values()) {
    if (options.package && pkg.path !== options.package) {
      continue;
    }
    if (options.ecosystem && pkg.ecosystem !== options.ecosystem) {
      continue;
    }

    const list = grouped.get(pkg.ecosystem) ?? [];
    list.push(pkg);
    grouped.set(pkg.ecosystem, list);
  }

  return grouped;
}
