import { t as __exportAll } from "./rolldown-runtime-CiIaOW0V.js";
import { h as formatSummary, m as formatHeader, p as formatCheckResult } from "./output-DN5bGOyX.js";
import { t as loadConfig } from "./loader-DPbQYX0n.js";
import { t as buildWorkspaceGraph } from "./workspace-MAuyT2B8.js";
import { n as checkBridges, t as checkEnvParity } from "./env-Em7GSr7p.js";
import { a as mergeLock, o as writeLock, r as loadLock, t as enrichEcosystems } from "./lock-CWRUuEwv.js";
import { n as collectDeps, r as findVersionMismatches, t as checkVersionConsistency } from "./versions-DgYM6vEv.js";
import { r as promptVersionResolution } from "./prompt-DoUcLmFP.js";
import { t as applyManifestUpdate } from "./manifest-writer-BwcLi-Sr.js";
//#region src/commands/check.ts
var check_exports = /* @__PURE__ */ __exportAll({ runCheck: () => runCheck });
/**
* Run all workspace checks and report results.
*
* @returns exit code (0 = all passed, 1 = failures found)
*/
async function runCheck(parsers, options = {}) {
	const { fix = false, quiet = false } = options;
	const { config, root } = await loadConfig();
	const graph = await buildWorkspaceGraph(config, root, parsers);
	let lock = await loadLock(root);
	if (lock) {
		const depMap = collectDeps(graph);
		const depEcosystems = /* @__PURE__ */ new Map();
		for (const [depName, occurrences] of depMap) depEcosystems.set(depName, [...new Set(occurrences.map((o) => o.ecosystem))]);
		const enriched = enrichEcosystems(lock, depEcosystems);
		if (enriched !== lock) {
			lock = enriched;
			await writeLock(root, lock);
		}
	}
	const results = [];
	results.push(checkVersionConsistency(graph, lock));
	if (graph.bridges.length > 0) results.push(checkBridges(graph));
	if (config.env) results.push(await checkEnvParity(config.env, root));
	if (graph.bridges.length > 0) {
		const { checkStaleness } = await import("./staleness-DbzYCXuY.js").then((n) => n.n);
		results.push(await checkStaleness(graph, root));
	}
	const allPassed = results.every((r) => r.passed);
	if (!quiet) {
		let header = formatHeader(graph.name, graph.packages.size);
		if (lock) {
			const count = Object.keys(lock.resolved).length;
			header += `  lock: neutron.lock (${count} resolved)\n`;
		}
		console.log(header);
		for (const result of results) console.log(formatCheckResult(result));
		console.log(formatSummary(results));
	} else if (!allPassed) {
		const failed = results.filter((r) => !r.passed);
		for (const result of failed) console.log(formatCheckResult(result));
	}
	if (fix) {
		const mismatches = findVersionMismatches(graph, lock);
		if (mismatches.length === 0) {
			console.log("No version mismatches to fix.\n");
			return allPassed ? 0 : 1;
		}
		const lockUpdates = [];
		let updatedCount = 0;
		for (const mismatch of mismatches) {
			const choices = mismatch.occurrences.map((o) => ({
				range: o.range,
				packagePath: o.packagePath,
				ecosystem: o.ecosystem,
				type: o.type
			}));
			const resolution = await promptVersionResolution(mismatch.depName, choices, mismatch.lockedRange);
			if (!resolution) continue;
			const ecosystems = [...new Set(mismatch.occurrences.map((o) => o.ecosystem))];
			lockUpdates.push({
				depName: resolution.depName,
				range: resolution.chosenRange,
				ecosystems
			});
			for (const target of resolution.targets) if (await applyManifestUpdate(root, {
				packagePath: target.packagePath,
				ecosystem: target.ecosystem,
				depName: resolution.depName,
				newRange: resolution.chosenRange
			})) {
				console.log(`  updated ${target.packagePath}: ${resolution.depName} → ${resolution.chosenRange}`);
				updatedCount++;
			} else console.log(`  skipped ${target.packagePath}: ${resolution.depName} (not writable)`);
		}
		if (lockUpdates.length > 0) {
			const newLock = mergeLock(lock, lockUpdates);
			await writeLock(root, newLock);
			const total = Object.keys(newLock.resolved).length;
			console.log(`\nmido.lock updated (${total} resolved)\n`);
		}
	}
	return allPassed ? 0 : 1;
}
//#endregion
export { runCheck as n, check_exports as t };

//# sourceMappingURL=check-CCPCyhFP.js.map