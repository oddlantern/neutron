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
		const consumerLabel = bridge.consumers.map((c) => c.path).join(", ");
		if (!graph.packages.has(bridge.source)) issues.push({
			severity: "error",
			check: "bridges",
			message: `Bridge source package not found in workspace: ${bridge.source}`,
			details: `Declared bridge: ${bridge.source} → [${consumerLabel}] via ${bridge.artifact}`
		});
		for (const consumer of bridge.consumers) if (!graph.packages.has(consumer.path)) issues.push({
			severity: "error",
			check: "bridges",
			message: `Bridge consumer package not found in workspace: ${consumer.path}`,
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
			const consumerPkg = graph.packages.get(consumer.path);
			if (consumerPkg && sourcePkg.ecosystem === consumerPkg.ecosystem) issues.push({
				severity: "warning",
				check: "bridges",
				message: `Bridge connects packages in the same ecosystem (${sourcePkg.ecosystem}): ${bridge.source} → ${consumer.path}`,
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
export { checkBridges as n, checkEnvParity as t };

//# sourceMappingURL=env-Em7GSr7p.js.map