import { spawnSync } from "node:child_process";

import { loadConfig } from "@/config/loader";
import { buildWorkspaceGraph } from "@/graph/workspace";
import type { ParserRegistry } from "@/graph/workspace";
import type { WorkspacePackage } from "@/graph/types";
import { BOLD, DIM, ORANGE, RESET } from "@/output";

export interface AffectedOptions {
  /** Git ref to diff against (default: HEAD~1) */
  readonly base?: string | undefined;
  /** Output as JSON array */
  readonly json?: boolean | undefined;
}

/**
 * Get the list of files changed between base ref and HEAD.
 */
function getChangedFiles(root: string, base: string): readonly string[] {
  try {
    const result = spawnSync("git", ["diff", "--name-only", base, "HEAD"], {
      cwd: root,
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      return [];
    }
    return (result.stdout ?? "")
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/** Path segments that indicate generated/non-source files */
const IGNORED_SEGMENTS = ["/generated/", "/node_modules/", "/.dart_tool/", "/build/", "/dist/"];

/**
 * Map changed files to the packages they belong to.
 * Filters out generated output and other non-source paths.
 */
export function filesToPackages(
  changedFiles: readonly string[],
  packages: ReadonlyMap<string, WorkspacePackage>,
): ReadonlySet<string> {
  const affected = new Set<string>();

  for (const file of changedFiles) {
    // Skip generated/non-source paths
    if (IGNORED_SEGMENTS.some((seg) => file.includes(seg.slice(1)))) {
      continue;
    }

    for (const [path] of packages) {
      if (file.startsWith(path + "/") || file === path) {
        affected.add(path);
      }
    }
  }

  return affected;
}

/**
 * Build a reverse dependency map: for each package, which packages depend on it.
 */
export function buildReverseDeps(
  packages: ReadonlyMap<string, WorkspacePackage>,
): ReadonlyMap<string, readonly string[]> {
  const reverse = new Map<string, string[]>();

  for (const [, pkg] of packages) {
    for (const dep of pkg.localDependencies) {
      const existing = reverse.get(dep);
      if (existing) {
        existing.push(pkg.path);
      } else {
        reverse.set(dep, [pkg.path]);
      }
    }
  }

  return reverse;
}

/**
 * Build a reverse bridge map: for each source, which packages consume its artifacts.
 */
export function buildReverseBridges(
  bridges: readonly { readonly source: string; readonly consumers: readonly string[] }[],
): ReadonlyMap<string, readonly string[]> {
  const reverse = new Map<string, string[]>();

  for (const bridge of bridges) {
    const existing = reverse.get(bridge.source);
    const consumers = [...bridge.consumers];
    if (existing) {
      for (const c of consumers) {
        if (!existing.includes(c)) {
          existing.push(c);
        }
      }
    } else {
      reverse.set(bridge.source, consumers);
    }
  }

  return reverse;
}

/**
 * Walk the graph forward from a set of directly changed packages,
 * following both dependency edges and bridge edges.
 */
export function walkForward(
  directlyChanged: ReadonlySet<string>,
  reverseDeps: ReadonlyMap<string, readonly string[]>,
  reverseBridges: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  const affected = new Set<string>(directlyChanged);
  const queue = [...directlyChanged];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      break;
    }

    // Follow dependency edges (packages that depend on current)
    const dependents = reverseDeps.get(current);
    if (dependents) {
      for (const dep of dependents) {
        if (!affected.has(dep)) {
          affected.add(dep);
          queue.push(dep);
        }
      }
    }

    // Follow bridge edges (packages that consume current's artifacts)
    const bridgeConsumers = reverseBridges.get(current);
    if (bridgeConsumers) {
      for (const consumer of bridgeConsumers) {
        if (!affected.has(consumer)) {
          affected.add(consumer);
          queue.push(consumer);
        }
      }
    }
  }

  return affected;
}

/**
 * Determine which packages are affected by changes since a base ref.
 *
 * Algorithm:
 * 1. git diff → changed files
 * 2. Map files → packages (direct changes)
 * 3. Walk forward through dependency graph + bridge edges
 * 4. Output affected package paths
 *
 * @returns exit code (0 = success)
 */
export async function runAffected(
  parsers: ParserRegistry,
  options: AffectedOptions = {},
): Promise<number> {
  const base = options.base ?? "HEAD~1";
  const { config, root } = await loadConfig();
  const graph = await buildWorkspaceGraph(config, root, parsers);

  const changedFiles = getChangedFiles(root, base);
  if (changedFiles.length === 0) {
    if (options.json) {
      console.log("[]");
    }
    return 0;
  }

  const directlyChanged = filesToPackages(changedFiles, graph.packages);
  const reverseDeps = buildReverseDeps(graph.packages);
  const reverseBridges = buildReverseBridges(graph.bridges);
  const affected = walkForward(directlyChanged, reverseDeps, reverseBridges);

  // Sort for deterministic output
  const sorted = [...affected].sort();

  if (options.json) {
    console.log(JSON.stringify(sorted, null, 2));
    return 0;
  }

  // Human-readable output
  if (sorted.length === 0) {
    console.log(`${DIM}No workspace packages affected.${RESET}`);
    return 0;
  }

  console.log(
    `\n${BOLD}mido affected${RESET} ${DIM}— ${sorted.length} package(s) affected since ${base}${RESET}\n`,
  );

  for (const path of sorted) {
    const isDirect = directlyChanged.has(path);
    const marker = isDirect ? `${ORANGE}*${RESET}` : `${DIM}→${RESET}`;
    const pkg = graph.packages.get(path);
    const eco = pkg ? ` ${DIM}(${pkg.ecosystem})${RESET}` : "";
    console.log(`  ${marker} ${path}${eco}`);
  }

  const directCount = [...sorted].filter((p) => directlyChanged.has(p)).length;
  const transitiveCount = sorted.length - directCount;
  console.log(
    `\n${DIM}${directCount} direct, ${transitiveCount} transitive${RESET}\n`,
  );

  return 0;
}
