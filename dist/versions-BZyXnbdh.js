#!/usr/bin/env node
import { t as __exportAll } from "./rolldown-runtime-QdrSlVMC.js";
import { n as getLockedRange } from "./lock-D-3owqTU.js";
//#region src/checks/versions.ts
var versions_exports = /* @__PURE__ */ __exportAll({
	checkVersionConsistency: () => checkVersionConsistency,
	collectDeps: () => collectDeps,
	findVersionMismatches: () => findVersionMismatches
});
/**
* Collect all non-local dependency occurrences from the workspace graph,
* grouped by dep name.
*/
function collectDeps(graph) {
	const depMap = /* @__PURE__ */ new Map();
	for (const pkg of graph.packages.values()) for (const dep of pkg.dependencies) {
		if (dep.range === "<local>") continue;
		const occurrences = depMap.get(dep.name) ?? [];
		occurrences.push({
			packagePath: pkg.path,
			packageName: pkg.name,
			ecosystem: pkg.ecosystem,
			range: dep.range,
			type: dep.type
		});
		depMap.set(dep.name, occurrences);
	}
	return depMap;
}
/**
* Find all version mismatches — structured data for use by --fix.
*
* If a lock exists and has an entry for a dep, any package whose range
* differs from the locked range is a mismatch.
* If no lock entry: flag if ranges differ between packages.
*/
function findVersionMismatches(graph, lock) {
	const depMap = collectDeps(graph);
	const mismatches = [];
	for (const [depName, occurrences] of depMap) {
		if (occurrences.length < 2) continue;
		const lockedRange = lock ? getLockedRange(lock, depName) : void 0;
		if (lockedRange) {
			if (occurrences.filter((o) => o.range !== lockedRange).length > 0) mismatches.push({
				depName,
				occurrences,
				lockedRange
			});
		} else if (new Set(occurrences.map((o) => o.range)).size > 1) mismatches.push({
			depName,
			occurrences,
			lockedRange: void 0
		});
	}
	return mismatches;
}
/**
* Scan all packages in the workspace graph and flag any dependency
* that appears in 2+ packages with different version ranges.
*
* This is ecosystem-agnostic — it compares raw range strings.
* "^1.2.3" in package.json and "^1.2.3" in pubspec.yaml are treated as equal.
* Different strings are flagged regardless of semantic equivalence.
*/
function checkVersionConsistency(graph, lock = null) {
	const depMap = collectDeps(graph);
	const issues = findVersionMismatches(graph, lock).map((m) => {
		if (m.lockedRange) {
			const details = m.occurrences.filter((o) => o.range !== m.lockedRange).map((o) => `  ${o.packagePath} (${o.ecosystem}): ${o.range} [${o.type}]`).join("\n");
			return {
				severity: "error",
				check: "versions",
				message: `"${m.depName}" deviates from locked range ${m.lockedRange}`,
				details
			};
		}
		const ranges = new Set(m.occurrences.map((o) => o.range));
		const details = m.occurrences.map((o) => `  ${o.packagePath} (${o.ecosystem}): ${o.range} [${o.type}]`).join("\n");
		return {
			severity: "error",
			check: "versions",
			message: `"${m.depName}" has ${ranges.size} different version ranges across ${m.occurrences.length} packages`,
			details
		};
	});
	const depCount = depMap.size;
	const multiPkgDeps = [...depMap.values()].filter((o) => o.length >= 2).length;
	return {
		check: "versions",
		passed: issues.length === 0,
		issues,
		summary: issues.length === 0 ? `${depCount} dependencies scanned, ${multiPkgDeps} shared — all consistent` : `${issues.length} version mismatch(es) found across ${multiPkgDeps} shared dependencies`
	};
}
//#endregion
export { versions_exports as i, collectDeps as n, findVersionMismatches as r, checkVersionConsistency as t };

//# sourceMappingURL=versions-BZyXnbdh.js.map