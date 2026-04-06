import type { WorkspacePackage } from "@/graph/types";

/**
 * Detect dependency cycles in the package graph.
 * Uses DFS with three-color marking (white → gray → black).
 *
 * @returns Array of cycles, each cycle is an array of package paths forming the loop.
 *          Empty array means no cycles.
 */
export function detectCycles(
  packages: ReadonlyMap<string, WorkspacePackage>,
): readonly (readonly string[])[] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<string, number>();
  for (const path of packages.keys()) {
    color.set(path, WHITE);
  }

  const cycles: string[][] = [];
  const stack: string[] = [];

  function dfs(node: string): void {
    color.set(node, GRAY);
    stack.push(node);

    const pkg = packages.get(node);
    if (pkg) {
      for (const dep of pkg.localDependencies) {
        const depColor = color.get(dep);
        if (depColor === undefined) {
          // Dependency is outside the package set — skip
          continue;
        }
        if (depColor === GRAY) {
          // Back edge → cycle found. Extract the cycle from the stack.
          const cycleStart = stack.indexOf(dep);
          cycles.push([...stack.slice(cycleStart), dep]);
        } else if (depColor === WHITE) {
          dfs(dep);
        }
      }
    }

    stack.pop();
    color.set(node, BLACK);
  }

  for (const path of packages.keys()) {
    if (color.get(path) === WHITE) {
      dfs(path);
    }
  }

  return cycles;
}

/**
 * Topological sort of packages using Kahn's algorithm.
 * Returns package paths in dependency order (dependencies first).
 *
 * Only considers edges within the provided package set — external
 * dependencies are ignored.
 *
 * @param subset - If provided, only sort these paths (must be a subset of packages).
 *                 Dependencies outside the subset are ignored for ordering.
 * @throws Error if a cycle is detected (should not happen if detectCycles ran first).
 */
export function topologicalSort(
  packages: ReadonlyMap<string, WorkspacePackage>,
  subset?: ReadonlySet<string>,
): readonly string[] {
  const nodes = subset ?? new Set(packages.keys());

  // Build in-degree map (only counting edges within the node set)
  const inDegree = new Map<string, number>();
  for (const path of nodes) {
    inDegree.set(path, 0);
  }

  for (const path of nodes) {
    const pkg = packages.get(path);
    if (!pkg) {
      continue;
    }
    for (const dep of pkg.localDependencies) {
      if (!nodes.has(dep)) {
        continue;
      }
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }

  // Note: in-degree is inverted here — we want dependencies first.
  // A package that IS depended on (has dependents) should come first.
  // So we count how many packages point TO each node as "in-degree",
  // but for Kahn's we need the reverse: packages with no dependencies come first.

  // Rebuild correctly: in-degree = number of local deps this package has within the set
  const depCount = new Map<string, number>();
  for (const path of nodes) {
    depCount.set(path, 0);
  }

  for (const path of nodes) {
    const pkg = packages.get(path);
    if (!pkg) {
      continue;
    }
    let count = 0;
    for (const dep of pkg.localDependencies) {
      if (nodes.has(dep)) {
        count++;
      }
    }
    depCount.set(path, count);
  }

  // Queue starts with packages that have zero in-set dependencies
  const queue: string[] = [];
  for (const [path, count] of depCount) {
    if (count === 0) {
      queue.push(path);
    }
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);

    // Find all packages in the set that depend on this node
    for (const path of nodes) {
      const pkg = packages.get(path);
      if (!pkg) {
        continue;
      }
      if (pkg.localDependencies.includes(node)) {
        const remaining = (depCount.get(path) ?? 1) - 1;
        depCount.set(path, remaining);
        if (remaining === 0) {
          queue.push(path);
        }
      }
    }
  }

  if (sorted.length !== nodes.size) {
    const stuck = [...nodes].filter((p) => !sorted.includes(p));
    throw new Error(
      `Dependency cycle detected among: ${stuck.join(", ")}`,
    );
  }

  return sorted;
}
