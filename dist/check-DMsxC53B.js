#!/usr/bin/env node
import { d as formatSummary, l as formatCheckResult, u as formatHeader } from "./output-D1Xg1ws_.js";
import { n as findVersionMismatches, t as checkVersionConsistency } from "./versions-CAkFDjVW.js";
import { t as loadConfig } from "./loader-BO3NzoPs.js";
import { t as buildWorkspaceGraph } from "./workspace-B2H5BXLY.js";
import { i as writeLock, r as mergeLock, t as loadLock } from "./lock-BkASfReh.js";
import { n as promptVersionResolution } from "./prompt-Z9fgX0Q5.js";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { isMap, parseDocument } from "yaml";
import { existsSync } from "node:fs";
//#region src/checks/bridges.ts
/**
* Validate that all declared bridges reference existing packages
* and that bridge artifacts exist on disk.
*/
function checkBridges(graph) {
	const issues = [];
	for (const bridge of graph.bridges) {
		if (!graph.packages.has(bridge.source)) issues.push({
			severity: "error",
			check: "bridges",
			message: `Bridge source package not found in workspace: ${bridge.source}`,
			details: `Declared bridge: ${bridge.source} → ${bridge.target} via ${bridge.artifact}`
		});
		if (!graph.packages.has(bridge.target)) issues.push({
			severity: "error",
			check: "bridges",
			message: `Bridge target package not found in workspace: ${bridge.target}`,
			details: `Declared bridge: ${bridge.source} → ${bridge.target} via ${bridge.artifact}`
		});
		const artifactPath = resolve(graph.root, bridge.artifact);
		if (!existsSync(artifactPath)) issues.push({
			severity: "error",
			check: "bridges",
			message: `Bridge artifact not found: ${bridge.artifact}`,
			details: `Expected at ${artifactPath}\nBridge: ${bridge.source} → ${bridge.target}`
		});
		const sourcePkg = graph.packages.get(bridge.source);
		const targetPkg = graph.packages.get(bridge.target);
		if (sourcePkg && targetPkg && sourcePkg.ecosystem === targetPkg.ecosystem) issues.push({
			severity: "warning",
			check: "bridges",
			message: `Bridge connects packages in the same ecosystem (${sourcePkg.ecosystem}): ${bridge.source} → ${bridge.target}`,
			details: "Bridges are intended for cross-ecosystem edges. Intra-ecosystem dependencies should be declared in manifest files."
		});
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
//#region src/manifest-writer.ts
const DEFAULT_INDENT = "  ";
const DEP_FIELDS_JSON = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies"
];
const packageJsonSchema = z.record(z.string(), z.unknown());
function applyManifestUpdate(root, update) {
	if (update.ecosystem === "dart") return writePubspec(root, update);
	return writePackageJson(root, update);
}
async function writePackageJson(root, update) {
	const filePath = join(root, update.packagePath, "package.json");
	const raw = await readFile(filePath, "utf-8");
	const indent = raw.match(/^(\s+)"/m)?.[1] ?? DEFAULT_INDENT;
	const manifest = packageJsonSchema.parse(JSON.parse(raw));
	let found = false;
	for (const field of DEP_FIELDS_JSON) {
		const deps = manifest[field];
		if (!isRecord(deps)) continue;
		if (!(update.depName in deps)) continue;
		deps[update.depName] = update.newRange;
		found = true;
	}
	if (!found) return false;
	await writeFile(filePath, JSON.stringify(manifest, null, indent) + "\n", "utf-8");
	return true;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function writePubspec(root, update) {
	const filePath = join(root, update.packagePath, "pubspec.yaml");
	const doc = parseDocument(await readFile(filePath, "utf-8"));
	const depFields = [
		"dependencies",
		"dev_dependencies",
		"dependency_overrides"
	];
	let found = false;
	for (const field of depFields) {
		const section = doc.get(field, true);
		if (!isMap(section)) continue;
		if (!section.has(update.depName)) continue;
		const currentValue = section.get(update.depName);
		if (typeof currentValue === "string" || typeof currentValue === "number" || !currentValue) {
			section.set(update.depName, update.newRange);
			found = true;
		} else if (isMap(currentValue)) {
			if (currentValue.has("version")) {
				currentValue.set("version", update.newRange);
				found = true;
			} else if (currentValue.has("path") || currentValue.has("git") || currentValue.has("sdk")) return false;
		}
	}
	if (!found) return false;
	await writeFile(filePath, doc.toString(), "utf-8");
	return true;
}
//#endregion
//#region src/commands/check.ts
/**
* Run all workspace checks and report results.
*
* @returns exit code (0 = all passed, 1 = failures found)
*/
async function runCheck(parsers, options = {}) {
	const { fix = false, quiet = false } = options;
	const { config, root } = await loadConfig();
	const graph = await buildWorkspaceGraph(config, root, parsers);
	const lock = await loadLock(root);
	const results = [];
	results.push(checkVersionConsistency(graph, lock));
	if (graph.bridges.length > 0) results.push(checkBridges(graph));
	if (config.env) results.push(await checkEnvParity(config.env, root));
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
		const resolutions = {};
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
			resolutions[resolution.depName] = resolution.chosenRange;
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
		if (Object.keys(resolutions).length > 0) {
			const newLock = mergeLock(lock, resolutions);
			await writeLock(root, newLock);
			const total = Object.keys(newLock.resolved).length;
			console.log(`\nmido.lock updated (${total} resolved)\n`);
		}
	}
	return allPassed ? 0 : 1;
}
//#endregion
export { runCheck };

//# sourceMappingURL=check-DMsxC53B.js.map