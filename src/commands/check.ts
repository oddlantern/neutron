import { loadConfig } from '../config/loader.js';
import type { CheckResult } from '../checks/types.js';
import { checkBridges } from '../checks/bridges.js';
import { checkEnvParity } from '../checks/env.js';
import { checkVersionConsistency, findVersionMismatches } from '../checks/versions.js';
import { buildWorkspaceGraph, type ParserRegistry } from '../graph/workspace.js';
import { formatCheckResult, formatHeader, formatSummary } from '../output.js';
import { loadLock, mergeLock, writeLock } from '../lock.js';
import { promptVersionResolution, closePrompt, type DepChoice } from '../prompt.js';
import { applyManifestUpdate } from '../manifest-writer.js';

/**
 * Run all workspace checks and report results.
 *
 * @returns exit code (0 = all passed, 1 = failures found)
 */
export async function runCheck(parsers: ParserRegistry, fix = false): Promise<number> {
  const { config, root } = await loadConfig();

  const graph = await buildWorkspaceGraph(config, root, parsers);
  const lock = await loadLock(root);

  let header = formatHeader(graph.name, graph.packages.size);
  if (lock) {
    const count = Object.keys(lock.resolved).length;
    header += `  lock: mido.lock (${count} resolved)\n`;
  }
  console.log(header);

  const results: CheckResult[] = [];

  // 1. Version consistency (always runs)
  results.push(checkVersionConsistency(graph, lock));

  // 2. Bridge validation (only if bridges are declared)
  if (graph.bridges.length > 0) {
    results.push(checkBridges(graph));
  }

  // 3. Env parity (only if env config is declared)
  if (config.env) {
    results.push(await checkEnvParity(config.env, root));
  }

  // Print results
  for (const result of results) {
    console.log(formatCheckResult(result));
  }

  console.log(formatSummary(results));

  // --fix flow
  if (fix) {
    const mismatches = findVersionMismatches(graph, lock);

    if (mismatches.length === 0) {
      console.log('No version mismatches to fix.\n');
      return results.every((r) => r.passed) ? 0 : 1;
    }

    // Map ecosystem names back to package paths for writer
    const pkgEcosystems = new Map<string, string>();
    for (const pkg of graph.packages.values()) {
      pkgEcosystems.set(pkg.path, pkg.ecosystem);
    }

    const resolutions: Record<string, string> = {};
    let updatedCount = 0;

    for (const mismatch of mismatches) {
      const choices: DepChoice[] = mismatch.occurrences.map((o) => ({
        range: o.range,
        packagePath: o.packagePath,
        ecosystem: o.ecosystem,
        type: o.type,
      }));

      const resolution = await promptVersionResolution(
        mismatch.depName,
        choices,
        mismatch.lockedRange,
      );

      if (!resolution) {
        continue;
      }

      resolutions[resolution.depName] = resolution.chosenRange;

      // Apply manifest updates for packages that need changing
      for (const target of resolution.targets) {
        const success = await applyManifestUpdate(root, {
          packagePath: target.packagePath,
          ecosystem: target.ecosystem,
          depName: resolution.depName,
          newRange: resolution.chosenRange,
        });

        if (success) {
          console.log(
            `  updated ${target.packagePath}: ${resolution.depName} → ${resolution.chosenRange}`,
          );
          updatedCount++;
        } else {
          console.log(`  skipped ${target.packagePath}: ${resolution.depName} (not writable)`);
        }
      }
    }

    closePrompt();

    if (Object.keys(resolutions).length > 0) {
      const newLock = mergeLock(lock, resolutions);
      await writeLock(root, newLock);
      const total = Object.keys(newLock.resolved).length;
      console.log(`\nmido.lock updated (${total} resolved)\n`);
    }
  }

  return results.every((r) => r.passed) ? 0 : 1;
}
