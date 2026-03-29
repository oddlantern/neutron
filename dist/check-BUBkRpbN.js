#!/usr/bin/env node
import { t as __exportAll } from "./rolldown-runtime-QdrSlVMC.js";
import { h as formatSummary, m as formatHeader, p as formatCheckResult } from "./output-MbJ98jNX.js";
import { a as mergeLock, o as writeLock, r as loadLock, t as enrichEcosystems } from "./lock-0DJ_gelN.js";
import { n as collectDeps, r as findVersionMismatches, t as checkVersionConsistency } from "./versions-C6rnLx1z.js";
import { t as loadConfig } from "./loader-FFG_yaOW.js";
import { t as buildWorkspaceGraph } from "./workspace-D1ScM76h.js";
import { r as promptVersionResolution } from "./prompt-DsWWicDa.js";
import { t as applyManifestUpdate } from "./manifest-writer-4mLd8drD.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
//#region src/checks/bridges.ts
/**
* Validate that all declared bridges reference existing packages
* and that bridge artifacts exist on disk.
*/
function checkBridges(graph) {
	const issues = [];
	for (const bridge of graph.bridges) {
		const consumerLabel = bridge.consumers.join(", ");
		if (!graph.packages.has(bridge.source)) issues.push({
			severity: "error",
			check: "bridges",
			message: `Bridge source package not found in workspace: ${bridge.source}`,
			details: `Declared bridge: ${bridge.source} → [${consumerLabel}] via ${bridge.artifact}`
		});
		for (const consumer of bridge.consumers) if (!graph.packages.has(consumer)) issues.push({
			severity: "error",
			check: "bridges",
			message: `Bridge consumer package not found in workspace: ${consumer}`,
			details: `Declared bridge: ${bridge.source} → [${consumerLabel}] via ${bridge.artifact}`
		});
		const artifactPath = resolve(graph.root, bridge.artifact);
		if (!existsSync(artifactPath)) issues.push({
			severity: "error",
			check: "bridges",
			message: `Bridge artifact not found: ${bridge.artifact}`,
			details: `Expected at ${artifactPath}\nBridge: ${bridge.source} → [${consumerLabel}]`
		});
		const sourcePkg = graph.packages.get(bridge.source);
		if (sourcePkg) for (const consumer of bridge.consumers) {
			const consumerPkg = graph.packages.get(consumer);
			if (consumerPkg && sourcePkg.ecosystem === consumerPkg.ecosystem) issues.push({
				severity: "warning",
				check: "bridges",
				message: `Bridge connects packages in the same ecosystem (${sourcePkg.ecosystem}): ${bridge.source} → ${consumer}`,
				details: "Bridges are intended for cross-ecosystem edges. Intra-ecosystem dependencies should be declared in manifest files."
			});
		}
	}
	return {
		check: "bridges",
		passed: issues.filter((i) => i.severity === "error").length === 0,
		issues,
		summary: issues.length === 0 ? `${graph.bridges.length} bridge(s) validated` : `${issues.length} bridge issue(s) found`
	};
}
//#endregion
//#region src/checks/env.ts
/**
* Parse a .env or .env.example file into a set of key names.
* Handles comments, empty lines, and inline comments.
*/
function parseEnvKeys(content) {
	const keys = /* @__PURE__ */ new Set();
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		const eqIndex = trimmed.indexOf("=");
		if (eqIndex === -1) continue;
		const key = trimmed.slice(0, eqIndex).trim();
		if (key.length > 0) keys.add(key);
	}
	return keys;
}
/**
* Check that all shared keys exist in every declared env file.
*/
async function checkEnvParity(envConfig, root) {
	const issues = [];
	const fileKeys = /* @__PURE__ */ new Map();
	for (const filePath of envConfig.files) {
		const absPath = resolve(root, filePath);
		if (!existsSync(absPath)) {
			issues.push({
				severity: "error",
				check: "env",
				message: `Env file not found: ${filePath}`
			});
			continue;
		}
		const content = await readFile(absPath, "utf-8");
		fileKeys.set(filePath, parseEnvKeys(content));
	}
	for (const key of envConfig.shared) {
		const missingIn = [];
		for (const [filePath, keys] of fileKeys) if (!keys.has(key)) missingIn.push(filePath);
		if (missingIn.length > 0) issues.push({
			severity: "error",
			check: "env",
			message: `Shared key "${key}" missing from: ${missingIn.join(", ")}`,
			details: `Expected in all of: ${envConfig.files.join(", ")}`
		});
	}
	return {
		check: "env",
		passed: issues.length === 0,
		issues,
		summary: issues.length === 0 ? `${envConfig.shared.length} shared key(s) verified across ${envConfig.files.length} file(s)` : `${issues.length} env parity issue(s) found`
	};
}
//#endregion
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
		const { checkStaleness } = await import("./staleness-COmJngf2.js");
		results.push(await checkStaleness(graph, root));
	}
	const allPassed = results.every((r) => r.passed);
	if (!quiet) {
		let header = formatHeader(graph.name, graph.packages.size);
		if (lock) {
			const count = Object.keys(lock.resolved).length;
			header += `  lock: mido.lock (${count} resolved)\n`;
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

//# sourceMappingURL=check-BUBkRpbN.js.map