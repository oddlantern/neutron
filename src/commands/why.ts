import { loadConfig } from "@/config/loader";
import { buildWorkspaceGraph } from "@/graph/workspace";
import type { ParserRegistry } from "@/graph/workspace";
import { BOLD, DIM, ORANGE, RESET } from "@/output";

export interface WhyOptions {
  readonly json?: boolean | undefined;
}

interface DepOccurrence {
  readonly package: string;
  readonly ecosystem: string;
  readonly range: string;
  readonly type: string;
}

/**
 * Show why a dependency exists in the workspace — which packages use it,
 * version ranges, and dependency types.
 *
 * @returns exit code (0 = found, 1 = not found)
 */
export async function runWhy(
  parsers: ParserRegistry,
  depName: string,
  options: WhyOptions = {},
): Promise<number> {
  const { config, root } = await loadConfig();
  const graph = await buildWorkspaceGraph(config, root, parsers);

  const occurrences: DepOccurrence[] = [];

  for (const [, pkg] of graph.packages) {
    for (const dep of pkg.dependencies) {
      if (dep.name === depName) {
        occurrences.push({
          package: pkg.path,
          ecosystem: pkg.ecosystem,
          range: dep.range,
          type: dep.type,
        });
      }
    }
  }

  if (occurrences.length === 0) {
    console.log(`${DIM}${depName} is not used in any workspace package.${RESET}`);
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify({ name: depName, occurrences }, null, 2));
    return 0;
  }

  console.log(
    `\n${BOLD}${depName}${RESET} ${DIM}— used in ${occurrences.length} package(s)${RESET}\n`,
  );

  // Group by ecosystem
  const byEcosystem = new Map<string, DepOccurrence[]>();
  for (const occ of occurrences) {
    const existing = byEcosystem.get(occ.ecosystem);
    if (existing) {
      existing.push(occ);
    } else {
      byEcosystem.set(occ.ecosystem, [occ]);
    }
  }

  for (const [eco, occs] of byEcosystem) {
    console.log(`  ${ORANGE}${eco}${RESET}`);
    for (const occ of occs) {
      console.log(`    ${occ.package} ${DIM}${occ.range} [${occ.type}]${RESET}`);
    }
  }

  // Check version consistency
  const ranges = new Set(occurrences.map((o) => o.range));
  if (ranges.size > 1) {
    console.log(
      `\n  ${ORANGE}${BOLD}warning:${RESET} ${ranges.size} different version ranges detected`,
    );
    console.log(`  ${DIM}Run \`neutron check --fix\` to resolve${RESET}`);
  }

  console.log();
  return 0;
}
