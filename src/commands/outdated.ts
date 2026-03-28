import { loadConfig } from "../config/loader.js";
import { isRecord } from "../guards.js";
import { buildWorkspaceGraph } from "../graph/workspace.js";
import type { ParserRegistry } from "../graph/workspace.js";
import type { WorkspacePackage } from "../graph/types.js";
import { BOLD, DIM, GREEN, ORANGE, RED, RESET, YELLOW } from "../output.js";

export interface OutdatedOptions {
  readonly json?: boolean | undefined;
}

interface DepUsage {
  readonly name: string;
  readonly ecosystem: string;
  readonly range: string;
  readonly packages: readonly string[];
}

interface RegistryInfo {
  readonly latest: string;
  readonly majorUpdate: boolean;
  readonly minorUpdate: boolean;
  readonly patchUpdate: boolean;
}

interface OutdatedDep {
  readonly name: string;
  readonly ecosystem: string;
  readonly workspaceRange: string;
  readonly packages: readonly string[];
  readonly latest: string;
  readonly severity: "major" | "minor" | "patch";
}

const NPM_REGISTRY = "https://registry.npmjs.org";
const PUB_DEV_API = "https://pub.dev/api/packages";
const FETCH_TIMEOUT_MS = 5000;

/**
 * Group workspace dependencies by name + ecosystem.
 * Returns the workspace-resolved range (highest/most common) and which packages use it.
 */
function collectDeps(
  packages: ReadonlyMap<string, WorkspacePackage>,
): readonly DepUsage[] {
  const map = new Map<string, { range: string; packages: string[]; ecosystem: string }>();

  for (const [, pkg] of packages) {
    for (const dep of pkg.dependencies) {
      // Skip dev/peer/optional for outdated check — focus on production deps
      if (dep.type !== "production") {
        continue;
      }
      const key = `${pkg.ecosystem}::${dep.name}`;
      const existing = map.get(key);
      if (existing) {
        existing.packages.push(pkg.path);
        // Keep the most common range (simplistic — first wins)
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
export function classifyUpdate(current: string, latest: string): "major" | "minor" | "patch" | null {
  const [cMajor, cMinor] = current.split(".").map(Number);
  const [lMajor, lMinor] = latest.split(".").map(Number);

  if (cMajor === undefined || cMinor === undefined || lMajor === undefined || lMinor === undefined) {
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
 * Fetch latest version from npm registry.
 */
async function fetchNpmLatest(name: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${NPM_REGISTRY}/${name}/latest`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      return null;
    }
    const data: unknown = await res.json();
    if (!isRecord(data) || typeof data["version"] !== "string") {
      return null;
    }
    return data["version"];
  } catch {
    return null;
  }
}

/**
 * Fetch latest version from pub.dev.
 */
async function fetchPubLatest(name: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${PUB_DEV_API}/${name}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      return null;
    }
    const data: unknown = await res.json();
    if (!isRecord(data)) {
      return null;
    }
    const latest = data["latest"];
    if (!isRecord(latest) || typeof latest["version"] !== "string") {
      return null;
    }
    return latest["version"];
  } catch {
    return null;
  }
}

/**
 * Fetch latest version for a dependency based on its ecosystem.
 */
async function fetchLatest(name: string, ecosystem: string): Promise<string | null> {
  if (ecosystem === "dart") {
    return fetchPubLatest(name);
  }
  return fetchNpmLatest(name);
}

/**
 * Check all workspace dependencies against their registries.
 *
 * @returns exit code (0 = all up to date, 1 = outdated deps found)
 */
export async function runOutdated(
  parsers: ParserRegistry,
  options: OutdatedOptions = {},
): Promise<number> {
  const { config, root } = await loadConfig();
  const graph = await buildWorkspaceGraph(config, root, parsers);

  const deps = collectDeps(graph.packages);
  if (deps.length === 0) {
    console.log(`${DIM}No production dependencies found.${RESET}`);
    return 0;
  }

  console.log(
    `\n${BOLD}mido outdated${RESET} ${DIM}\u2014 checking ${deps.length} dependencies...${RESET}\n`,
  );

  // Fetch in parallel with concurrency limit
  const CONCURRENCY = 10;
  const outdated: OutdatedDep[] = [];
  let checked = 0;

  for (let i = 0; i < deps.length; i += CONCURRENCY) {
    const batch = deps.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (dep) => {
        const latest = await fetchLatest(dep.name, dep.ecosystem);
        checked++;
        return { dep, latest };
      }),
    );

    for (const { dep, latest } of results) {
      if (!latest) {
        continue;
      }
      const current = stripRange(dep.range);
      const severity = classifyUpdate(current, latest);
      if (severity) {
        outdated.push({
          name: dep.name,
          ecosystem: dep.ecosystem,
          workspaceRange: dep.range,
          packages: dep.packages,
          latest,
          severity,
        });
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(outdated, null, 2));
    return outdated.length > 0 ? 1 : 0;
  }

  if (outdated.length === 0) {
    console.log(`${GREEN}All ${checked} dependencies are up to date.${RESET}\n`);
    return 0;
  }

  // Group: shared deps first (used by multiple packages), then by severity
  const shared = outdated.filter((d) => d.packages.length > 1);
  const single = outdated.filter((d) => d.packages.length === 1);

  const severityColor = { major: RED, minor: YELLOW, patch: DIM };
  const severityLabel = { major: "MAJOR", minor: "MINOR", patch: "PATCH" };

  function printDep(dep: OutdatedDep): void {
    const color = severityColor[dep.severity];
    const label = severityLabel[dep.severity];
    const current = stripRange(dep.workspaceRange);
    console.log(
      `  ${color}${label}${RESET} ${BOLD}${dep.name}${RESET} ${DIM}${current} \u2192${RESET} ${color}${dep.latest}${RESET} ${DIM}(${dep.ecosystem}, ${dep.packages.length} pkg)${RESET}`,
    );
  }

  if (shared.length > 0) {
    console.log(`${ORANGE}${BOLD}Shared dependencies${RESET} ${DIM}(used across multiple packages)${RESET}`);
    for (const dep of shared) {
      printDep(dep);
    }
    console.log();
  }

  if (single.length > 0) {
    console.log(`${BOLD}Other dependencies${RESET}`);
    for (const dep of single) {
      printDep(dep);
    }
    console.log();
  }

  const majorCount = outdated.filter((d) => d.severity === "major").length;
  const minorCount = outdated.filter((d) => d.severity === "minor").length;
  const patchCount = outdated.filter((d) => d.severity === "patch").length;

  console.log(
    `${DIM}${outdated.length} outdated: ${RED}${majorCount} major${RESET}${DIM}, ${YELLOW}${minorCount} minor${RESET}${DIM}, ${patchCount} patch${RESET}`,
  );
  console.log(
    `${DIM}Use your package manager to update (bun update, dart pub upgrade).${RESET}`,
  );
  console.log(
    `${DIM}Then run ${BOLD}mido check${RESET} ${DIM}to verify version consistency.${RESET}\n`,
  );

  return 0;
}

/**
 * Quick one-liner check for mido dev startup.
 * Returns a summary string or null if all up to date.
 */
export async function quickOutdatedCheck(
  parsers: ParserRegistry,
): Promise<string | null> {
  try {
    const { config, root } = await loadConfig();
    const graph = await buildWorkspaceGraph(config, root, parsers);
    const deps = collectDeps(graph.packages);

    // Only check shared deps for the quick check (most impactful)
    const sharedDeps = deps.filter((d) => d.packages.length > 1).slice(0, 5);
    if (sharedDeps.length === 0) {
      return null;
    }

    let outdatedCount = 0;
    const results = await Promise.all(
      sharedDeps.map(async (dep) => {
        const latest = await fetchLatest(dep.name, dep.ecosystem);
        if (!latest) {
          return null;
        }
        const current = stripRange(dep.range);
        return classifyUpdate(current, latest) ? dep.name : null;
      }),
    );

    for (const r of results) {
      if (r) {
        outdatedCount++;
      }
    }

    if (outdatedCount === 0) {
      return null;
    }

    return `${outdatedCount} shared dep(s) have updates. Run \`mido outdated\` for details.`;
  } catch {
    return null;
  }
}
