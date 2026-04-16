import type { WorkspacePackage } from "@/graph/types";

import type { DepUsage } from "@/outdated/types";

/**
 * Group workspace dependencies by name + ecosystem.
 * Returns the workspace-resolved range (first wins) and which packages use it.
 */
export function collectDeps(packages: ReadonlyMap<string, WorkspacePackage>): readonly DepUsage[] {
  const map = new Map<string, { range: string; packages: string[]; ecosystem: string }>();

  for (const [, pkg] of packages) {
    for (const dep of pkg.dependencies) {
      if (dep.type !== "production") {
        continue;
      }
      const key = `${pkg.ecosystem}::${dep.name}`;
      const existing = map.get(key);
      if (existing) {
        existing.packages.push(pkg.path);
      } else {
        map.set(key, { range: dep.range, packages: [pkg.path], ecosystem: pkg.ecosystem });
      }
    }
  }

  const result: DepUsage[] = [];
  for (const [key, val] of map) {
    const name = key.split("::")[1];
    if (name) {
      result.push({ name, ecosystem: val.ecosystem, range: val.range, packages: val.packages });
    }
  }

  return result.sort((a, b) => b.packages.length - a.packages.length);
}

/**
 * Strip semver prefix characters to get the raw version.
 */
export function stripRange(range: string): string {
  return range.replace(/^[\^~>=<\s]+/, "").split(/\s/)[0] ?? range;
}

/**
 * Compare two semver strings and determine the severity of the update.
 */
export function classifyUpdate(
  current: string,
  latest: string,
): "major" | "minor" | "patch" | null {
  const [cMajor, cMinor] = current.split(".").map(Number);
  const [lMajor, lMinor] = latest.split(".").map(Number);

  if (
    cMajor === undefined ||
    cMinor === undefined ||
    lMajor === undefined ||
    lMinor === undefined
  ) {
    return null;
  }

  if (lMajor > cMajor) {
    return "major";
  }
  if (lMinor > cMinor) {
    return "minor";
  }
  if (latest !== current) {
    return "patch";
  }
  return null;
}

/**
 * Build a flat map of all workspace dependency ranges keyed by name.
 * Used for peer conflict detection.
 */
export function buildWorkspaceDepsMap(
  packages: ReadonlyMap<string, WorkspacePackage>,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const [, pkg] of packages) {
    for (const dep of pkg.dependencies) {
      if (!map.has(dep.name)) {
        map.set(dep.name, dep.range);
      }
    }
  }
  return map;
}

/**
 * Check if any Dart package in the workspace has a Flutter dependency.
 */
export function hasFlutterDeps(packages: ReadonlyMap<string, WorkspacePackage>): boolean {
  for (const [, pkg] of packages) {
    if (pkg.ecosystem !== "dart") {
      continue;
    }
    for (const dep of pkg.dependencies) {
      if (dep.name === "flutter") {
        return true;
      }
    }
  }
  return false;
}
