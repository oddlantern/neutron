#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { existsSync } from "node:fs";
import { z } from "zod";
//#region src/config/schema.ts
const ecosystemSchema = z.object({
	manifest: z.string(),
	lockfile: z.string().optional(),
	packages: z.array(z.string()).min(1)
});
const bridgeSchema = z.object({
	from: z.string(),
	to: z.string(),
	via: z.string()
});
const envSchema = z.object({
	shared: z.array(z.string()).min(1),
	files: z.array(z.string()).min(2)
});
const configSchema = z.object({
	workspace: z.string(),
	ecosystems: z.record(z.string(), ecosystemSchema).refine((eco) => Object.keys(eco).length >= 1, { message: "At least one ecosystem must be defined" }),
	bridges: z.array(bridgeSchema).optional(),
	env: envSchema.optional()
});
//#endregion
//#region src/config/loader.ts
const CONFIG_FILENAMES = ["mido.yml", "mido.yaml"];
/**
* Walk upward from `startDir` until we find a mido.yml/mido.yaml.
* Returns the absolute path to the config file, or null if not found.
*/
function findConfigFile(startDir) {
	let current = startDir;
	while (true) {
		for (const filename of CONFIG_FILENAMES) {
			const candidate = join(current, filename);
			if (existsSync(candidate)) return candidate;
		}
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}
/**
* Locate and parse the mido config file.
* Searches upward from the given directory (defaults to cwd).
*
* @throws {Error} if no config file is found or validation fails
*/
async function loadConfig(startDir) {
	const searchFrom = startDir ?? process.cwd();
	const configPath = findConfigFile(searchFrom);
	if (configPath === null) throw new Error(`No mido.yml found. Searched upward from ${searchFrom}\nCreate a mido.yml in your workspace root to get started.`);
	const raw = await readFile(configPath, "utf-8");
	let parsed;
	try {
		parsed = parse(raw);
	} catch (cause) {
		throw new Error(`Invalid YAML in ${configPath}`, { cause });
	}
	const result = configSchema.safeParse(parsed);
	if (!result.success) {
		const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
		throw new Error(`Invalid mido config at ${configPath}:\n${issues}`);
	}
	const root = dirname(configPath);
	return {
		config: result.data,
		root,
		configPath
	};
}
//#endregion
//#region src/checks/bridges.ts
/**
* Validate that all declared bridges reference existing packages
* and that bridge artifacts exist on disk.
*/
function checkBridges(graph) {
	const issues = [];
	for (const bridge of graph.bridges) {
		if (!graph.packages.has(bridge.from)) issues.push({
			severity: "error",
			check: "bridges",
			message: `Bridge "from" package not found in workspace: ${bridge.from}`,
			details: `Declared bridge: ${bridge.from} → ${bridge.to} via ${bridge.via}`
		});
		if (!graph.packages.has(bridge.to)) issues.push({
			severity: "error",
			check: "bridges",
			message: `Bridge "to" package not found in workspace: ${bridge.to}`,
			details: `Declared bridge: ${bridge.from} → ${bridge.to} via ${bridge.via}`
		});
		const viaPath = resolve(graph.root, bridge.via);
		if (!existsSync(viaPath)) issues.push({
			severity: "error",
			check: "bridges",
			message: `Bridge artifact not found: ${bridge.via}`,
			details: `Expected at ${viaPath}\nBridge: ${bridge.from} → ${bridge.to}`
		});
		const fromPkg = graph.packages.get(bridge.from);
		const toPkg = graph.packages.get(bridge.to);
		if (fromPkg !== void 0 && toPkg !== void 0 && fromPkg.ecosystem === toPkg.ecosystem) issues.push({
			severity: "warning",
			check: "bridges",
			message: `Bridge connects packages in the same ecosystem (${fromPkg.ecosystem}): ${bridge.from} → ${bridge.to}`,
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
* Scan all packages in the workspace graph and flag any dependency
* that appears in 2+ packages with different version ranges.
*
* This is ecosystem-agnostic — it compares raw range strings.
* "^1.2.3" in package.json and "^1.2.3" in pubspec.yaml are treated as equal.
* Different strings are flagged regardless of semantic equivalence.
*/
function checkVersionConsistency(graph) {
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
	const issues = [];
	for (const [depName, occurrences] of depMap) {
		if (occurrences.length < 2) continue;
		const ranges = new Set(occurrences.map((o) => o.range));
		if (ranges.size <= 1) continue;
		const details = occurrences.map((o) => `  ${o.packagePath} (${o.ecosystem}): ${o.range} [${o.type}]`).join("\n");
		issues.push({
			severity: "error",
			check: "versions",
			message: `"${depName}" has ${ranges.size} different version ranges across ${occurrences.length} packages`,
			details
		});
	}
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
		if (parser === void 0) {
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
		from: b.from,
		to: b.to,
		via: b.via
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
	if (issue.details !== void 0) {
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
//#region src/commands/check.ts
/**
* Run all workspace checks and report results.
*
* @returns exit code (0 = all passed, 1 = failures found)
*/
async function runCheck(parsers) {
	const { config, root } = await loadConfig();
	const graph = await buildWorkspaceGraph(config, root, parsers);
	console.log(formatHeader(graph.name, graph.packages.size));
	const results = [];
	results.push(checkVersionConsistency(graph));
	if (graph.bridges.length > 0) results.push(checkBridges(graph));
	if (config.env !== void 0) results.push(await checkEnvParity(config.env, root));
	for (const result of results) console.log(formatCheckResult(result));
	console.log(formatSummary(results));
	return results.every((r) => r.passed) ? 0 : 1;
}
//#endregion
export { runCheck };

//# sourceMappingURL=check-zfuGgETa.js.map