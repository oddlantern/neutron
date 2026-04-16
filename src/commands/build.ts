import { loadConfig } from "@/config/loader";
import { DiagnosticCollector, formatDiagnostics } from "@/diagnostic";
import { groupByEcosystem } from "@/commands/group";
import { buildWorkspaceGraph } from "@/graph/workspace";
import type { ParserRegistry } from "@/graph/workspace";
import type { WorkspacePackage } from "@/graph/types";
import { topologicalSort } from "@/graph/topo";
import { BOLD, DIM, FAIL, PASS, RESET } from "@/output";
import { loadPlugins } from "@/plugins/loader";
import { PluginRegistry } from "@/plugins/registry";
import { STANDARD_ACTIONS } from "@/plugins/types";
import { detectPackageManager } from "@/pm-detect";

const SKIP = `${DIM}·${RESET}`;
const MS_PER_SECOND = 1000;

export interface BuildOptions {
  readonly quiet?: boolean | undefined;
  readonly package?: string | undefined;
  /** Build all packages including apps (leaf nodes). Default: packages only. */
  readonly all?: boolean | undefined;
}

/**
 * Build a set of package paths that have at least one workspace dependent.
 * Packages with dependents are libraries — packages without are apps (leaf nodes).
 */
function findLibraryPaths(
  packages: ReadonlyMap<string, WorkspacePackage>,
): ReadonlySet<string> {
  const hasDependent = new Set<string>();

  for (const pkg of packages.values()) {
    for (const dep of pkg.localDependencies) {
      hasDependent.add(dep);
    }
  }

  return hasDependent;
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
  const libraryPaths = options.all ? null : findLibraryPaths(graph.packages);
  const diag = new DiagnosticCollector();
  let builtCount = 0;
  let skippedApps = 0;

  for (const [ecosystem, packages] of grouped) {
    if (!quiet) {
      console.log(
        `\n${DIM}◇${RESET} ${BOLD}${ecosystem}${RESET} ${DIM}(${packages.length} packages)${RESET}`,
      );
    }

    // Topologically sort within ecosystem so dependencies build first
    const pkgPaths = new Set(packages.map((p) => p.path));
    const sorted = topologicalSort(graph.packages, pkgPaths);
    const sortedPackages = sorted
      .map((p) => graph.packages.get(p))
      .filter((p): p is WorkspacePackage => p !== undefined);

    for (const pkg of sortedPackages) {
      // Skip leaf nodes (apps) unless --all
      if (libraryPaths && !libraryPaths.has(pkg.path)) {
        skippedApps++;
        if (!quiet) {
          console.log(`  ${SKIP} ${pkg.path} ${DIM}— app (use --all to include)${RESET}`);
        }
        continue;
      }

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

      if (result.success) {
        builtCount++;
      } else {
        const firstLine = result.output?.trim().split("\n")[0] ?? "";
        diag.error(`Build failed: ${pkg.path}`, {
          detail: firstLine,
          fix: `Run neutron build --package ${pkg.path} for full output`,
        });
      }

      if (quiet && result.success) {
        continue;
      }

      const icon = result.success ? PASS : FAIL;
      const timing =
        result.duration > 0 ? ` ${DIM}(${(result.duration / MS_PER_SECOND).toFixed(1)}s)${RESET}` : "";
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

  if (!quiet || diag.hasIssues) {
    const appNote = skippedApps > 0 ? `${DIM}(${skippedApps} app(s) skipped)${RESET}` : "";
    if (appNote) {
      console.log(`\n${appNote}`);
    }
    console.log(formatDiagnostics(diag, builtCount));
  }

  return diag.hasErrors ? 1 : 0;
}
