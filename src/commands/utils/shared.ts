import { cancel } from "@clack/prompts";

import type { MidoConfig } from "../../config/schema.js";
import type { DiscoveredPackage } from "../../discovery/scanner.js";
import { BOLD, DIM, ORANGE, RESET } from "../../output.js";

export const CONFIG_FILENAME = "mido.yml";
export const MIN_ENV_FILES_FOR_PARITY = 2;

export const ECOSYSTEM_MANIFESTS: Readonly<Record<string, string>> = {
  typescript: "package.json",
  dart: "pubspec.yaml",
};

export interface EcosystemGroup {
  readonly manifest: string;
  readonly packages: readonly string[];
}

export interface BridgeWithWatch {
  readonly source: string;
  readonly consumers: readonly string[];
  readonly artifact: string;
  readonly watch: readonly string[] | undefined;
}

export interface InitSummary {
  readonly packageCount: number;
  readonly ecosystemCount: number;
  readonly bridgeCount: number;
  readonly hooksInstalled: boolean;
  readonly checksPass: boolean;
}

export class CancelError extends Error {
  constructor() {
    super("Aborted.");
    this.name = "CancelError";
  }
}

export function handleCancel(): never {
  cancel("Aborted.");
  throw new CancelError();
}

// ─── Package map helper ─────────────────────────────────────────────────────

/**
 * Build a lightweight WorkspacePackage map from discovered packages.
 * Used during init to provide context to plugin watch path suggestions
 * before the full workspace graph is built.
 */
export function buildPackageMap(
  packages: readonly DiscoveredPackage[],
): ReadonlyMap<string, import("../../graph/types.js").WorkspacePackage> {
  const map = new Map<string, import("../../graph/types.js").WorkspacePackage>();

  for (const pkg of packages) {
    map.set(pkg.path, {
      name: pkg.path.split("/").pop() ?? pkg.path,
      path: pkg.path,
      ecosystem: pkg.ecosystem,
      version: undefined,
      dependencies: [],
      localDependencies: [],
    });
  }

  return map;
}

// ─── Config helpers ─────────────────────────────────────────────────────────

export function getAllPackagePaths(config: MidoConfig): string[] {
  const paths: string[] = [];
  for (const group of Object.values(config.ecosystems)) {
    paths.push(...group.packages);
  }
  return paths.sort();
}

export function addPackageToConfig(config: MidoConfig, pkg: DiscoveredPackage): void {
  const eco = config.ecosystems[pkg.ecosystem];
  if (eco) {
    config.ecosystems[pkg.ecosystem] = {
      ...eco,
      packages: [...eco.packages, pkg.path].sort(),
    };
  } else {
    config.ecosystems[pkg.ecosystem] = {
      manifest: ECOSYSTEM_MANIFESTS[pkg.ecosystem] ?? pkg.manifest,
      packages: [pkg.path],
    };
  }
}

export function removePackageFromConfig(config: MidoConfig, path: string): void {
  for (const [ecoName, group] of Object.entries(config.ecosystems)) {
    if (!group.packages.includes(path)) {
      continue;
    }
    const remaining = group.packages.filter((p) => p !== path);
    // Remove ecosystem if no packages left
    if (remaining.length === 0) {
      delete config.ecosystems[ecoName];
    } else {
      config.ecosystems[ecoName] = { ...group, packages: remaining };
    }
    return;
  }
}

// ─── Display helpers ────────────────────────────────────────────────────────

export function formatEcosystemList(ecosystems: Record<string, EcosystemGroup>): string {
  const lines: string[] = [];
  for (const [name, group] of Object.entries(ecosystems)) {
    lines.push(
      `  ${ORANGE}${BOLD}${name}${RESET} ${DIM}(${group.packages.length} packages)${RESET}`,
    );
    for (const pkg of group.packages) {
      lines.push(`    ${DIM}${pkg}${RESET}`);
    }
  }
  return lines.join("\n");
}

export function groupDiscoveredByEcosystem(
  packages: readonly DiscoveredPackage[],
): Record<string, EcosystemGroup> {
  // Collect into mutable arrays first, then freeze into readonly
  const temp: Record<string, { manifest: string; packages: string[] }> = {};

  for (const pkg of packages) {
    if (!temp[pkg.ecosystem]) {
      temp[pkg.ecosystem] = {
        manifest: ECOSYSTEM_MANIFESTS[pkg.ecosystem] ?? pkg.manifest,
        packages: [],
      };
    }
    temp[pkg.ecosystem]?.packages.push(pkg.path);
  }

  const groups: Record<string, EcosystemGroup> = {};
  for (const [eco, group] of Object.entries(temp)) {
    groups[eco] = { manifest: group.manifest, packages: group.packages.sort() };
  }

  return groups;
}

// ─── Re-exports from split modules ──────────────────────────────────────────

export {
  promptWatchPaths,
  promptModifyBridge,
  promptAdditionalBridges,
} from "./prompts.js";

export {
  runPostInitCheck,
  promptNextSteps,
  cleanupReplacedTooling,
} from "./cleanup.js";
