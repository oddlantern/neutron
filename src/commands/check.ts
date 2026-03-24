import { loadConfig } from '../config/loader.js';
import type { CheckResult } from '../checks/types.js';
import { checkBridges } from '../checks/bridges.js';
import { checkEnvParity } from '../checks/env.js';
import { checkVersionConsistency } from '../checks/versions.js';
import { buildWorkspaceGraph, type ParserRegistry } from '../graph/workspace.js';
import { formatCheckResult, formatHeader, formatSummary } from '../output.js';

/**
 * Run all workspace checks and report results.
 *
 * @returns exit code (0 = all passed, 1 = failures found)
 */
export async function runCheck(parsers: ParserRegistry): Promise<number> {
  const { config, root } = await loadConfig();

  const graph = await buildWorkspaceGraph(config, root, parsers);

  console.log(formatHeader(graph.name, graph.packages.size));

  const results: CheckResult[] = [];

  // 1. Version consistency (always runs)
  results.push(checkVersionConsistency(graph));

  // 2. Bridge validation (only if bridges are declared)
  if (graph.bridges.length > 0) {
    results.push(checkBridges(graph));
  }

  // 3. Env parity (only if env config is declared)
  if (config.env !== undefined) {
    results.push(await checkEnvParity(config.env, root));
  }

  // Print results
  for (const result of results) {
    console.log(formatCheckResult(result));
  }

  console.log(formatSummary(results));

  return results.every((r) => r.passed) ? 0 : 1;
}
