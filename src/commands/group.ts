import type { WorkspacePackage } from "@/graph/types";

export interface FilterOptions {
  readonly package?: string | undefined;
  readonly ecosystem?: string | undefined;
}

/** Group packages by ecosystem, applying optional filters */
export function groupByEcosystem(
  packages: ReadonlyMap<string, WorkspacePackage>,
  options: FilterOptions,
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
