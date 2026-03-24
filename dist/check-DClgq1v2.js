#!/usr/bin/env node
import { t as loadConfig } from "./loader-nzFN8Dng.js";
import { n as closePrompt, r as promptVersionResolution } from "./prompt-BLf9wcmi.js";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { isMap, parse, parseDocument, stringify } from "yaml";
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
//#region src/checks/versions.ts
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
		const lockedRange = lock?.resolved[depName];
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
//#region src/graph/workspace.ts
/**
* Build the complete workspace graph from config and manifest parsers.
*
* Steps:
* 1. For each ecosystem, resolve package paths
* 2. Parse each manifest using the ecosystem's parser
* 3. Resolve local dependency paths to workspace-relative paths
* 4. Assemble bridges from config
*/
async function buildWorkspaceGraph(config, root, parsers) {
	const packages = /* @__PURE__ */ new Map();
	const errors = [];
	for (const [ecosystemName, ecosystemConfig] of Object.entries(config.ecosystems)) {
		const parser = parsers.get(ecosystemConfig.manifest);
		if (!parser) {
			errors.push(`No parser registered for manifest "${ecosystemConfig.manifest}" (ecosystem: ${ecosystemName})`);
			continue;
		}
		for (const pkgGlob of ecosystemConfig.packages) {
			const pkgDir = resolve(root, pkgGlob);
			const manifestPath = join(pkgDir, ecosystemConfig.manifest);
			if (!existsSync(manifestPath)) {
				errors.push(`Manifest not found: ${manifestPath} (ecosystem: ${ecosystemName}, package: ${pkgGlob})`);
				continue;
			}
			try {
				const parsed = await parser.parse(manifestPath);
				const relativePath = relative(root, pkgDir);
				const localDependencies = parsed.localDependencyPaths.map((absPath) => relative(root, absPath)).filter((relPath) => packages.has(relPath) || isInPackageList(config, relPath));
				const pkg = {
					name: parsed.name,
					path: relativePath,
					ecosystem: ecosystemName,
					version: parsed.version,
					dependencies: parsed.dependencies,
					localDependencies
				};
				packages.set(relativePath, pkg);
			} catch (cause) {
				errors.push(`Failed to parse ${manifestPath}: ${cause instanceof Error ? cause.message : String(cause)}`);
			}
		}
	}
	if (errors.length > 0) throw new Error(`Workspace graph build failed with ${errors.length} error(s):\n` + errors.map((e) => `  - ${e}`).join("\n"));
	const resolvedPackages = /* @__PURE__ */ new Map();
	for (const [path, pkg] of packages) {
		const resolvedLocalDeps = pkg.localDependencies.filter((dep) => packages.has(dep));
		resolvedPackages.set(path, {
			...pkg,
			localDependencies: resolvedLocalDeps
		});
	}
	const bridges = (config.bridges ?? []).map((b) => ({
		source: b.source,
		target: b.target,
		artifact: b.artifact
	}));
	return {
		name: config.workspace,
		root,
		packages: resolvedPackages,
		bridges
	};
}
/** Check if a relative path is declared in any ecosystem's package list */
function isInPackageList(config, relPath) {
	for (const eco of Object.values(config.ecosystems)) if (eco.packages.includes(relPath)) return true;
	return false;
}
//#endregion
//#region src/output.ts
const RESET = "\x1B[0m";
const BOLD = "\x1B[1m";
const DIM = "\x1B[2m";
const RED = "\x1B[31m";
const GREEN = "\x1B[32m";
const YELLOW = "\x1B[33m";
const CYAN = "\x1B[36m";
const PASS = `${GREEN}✓${RESET}`;
const FAIL = `${RED}✗${RESET}`;
const WARN = `${YELLOW}⚠${RESET}`;
function formatIssue(issue) {
	let output = `  ${issue.severity === "error" ? FAIL : WARN} ${issue.severity === "error" ? RED : YELLOW}${issue.message}${RESET}`;
	if (issue.details) {
		const indented = issue.details.split("\n").map((line) => `    ${DIM}${line}${RESET}`).join("\n");
		output += `\n${indented}`;
	}
	return output;
}
function formatCheckResult(result) {
	const header = `${result.passed ? PASS : FAIL} ${BOLD}${result.check}${RESET} ${DIM}— ${result.summary}${RESET}`;
	if (result.issues.length === 0) return header;
	return `${header}\n${result.issues.map(formatIssue).join("\n")}`;
}
function formatSummary(results) {
	const passed = results.filter((r) => r.passed).length;
	const failed = results.length - passed;
	const line = "─".repeat(48);
	if (failed === 0) return `\n${DIM}${line}${RESET}\n${GREEN}${BOLD}All ${passed} check(s) passed${RESET}\n`;
	return `\n${DIM}${line}${RESET}\n${RED}${BOLD}${failed} check(s) failed${RESET}, ${passed} passed\n`;
}
function formatHeader(workspaceName, packageCount) {
	return `\n${CYAN}${BOLD}mido${RESET} ${DIM}— workspace: ${workspaceName} (${packageCount} packages)${RESET}\n`;
}
//#endregion
//#region src/lock.ts
const LOCK_FILENAME = "mido.lock";
const LOCK_HEADER = `# Auto-generated by mido check --fix
# This file is the source of truth for cross-package version policy.
# Commit this file to version control.
`;
const lockSchema = z.object({ resolved: z.record(z.string(), z.string()) });
async function loadLock(root) {
	const lockPath = join(root, LOCK_FILENAME);
	if (!existsSync(lockPath)) return null;
	try {
		const parsed = parse(await readFile(lockPath, "utf-8"));
		const result = lockSchema.safeParse(parsed);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}
async function writeLock(root, lock) {
	const lockPath = join(root, LOCK_FILENAME);
	const sorted = {};
	for (const key of Object.keys(lock.resolved).sort()) {
		const value = lock.resolved[key];
		if (!value) continue;
		sorted[key] = value;
	}
	const body = stringify({ resolved: sorted });
	await writeFile(lockPath, LOCK_HEADER + "\n" + body, "utf-8");
}
function mergeLock(existing, updates) {
	return { resolved: {
		...existing?.resolved,
		...updates
	} };
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
		closePrompt();
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

//# sourceMappingURL=check-DClgq1v2.js.map