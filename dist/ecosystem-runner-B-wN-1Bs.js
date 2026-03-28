#!/usr/bin/env node
import { c as PASS, i as FAIL, r as DIM, t as BOLD, u as RESET } from "./output-MbJ98jNX.js";
import { t as loadConfig } from "./loader-CYxgXRd0.js";
import { t as buildWorkspaceGraph } from "./workspace-22OBPV16.js";
import { t as groupByEcosystem } from "./group-C7C6m5mM.js";
import { n as loadPlugins, t as PluginRegistry } from "./registry-BFpbFSAu.js";
import { t as detectPackageManager } from "./pm-detect-XlYC3uej.js";
import { join, relative } from "node:path";
import { readdirSync, statSync } from "node:fs";
//#region src/files/resolver.ts
/** Directories always excluded from file resolution */
const ALWAYS_EXCLUDED = [
	"node_modules",
	".dart_tool",
	"build",
	"dist",
	".git"
];
/**
* Normalize an ignore pattern for matching:
*  - Strip leading "./"
*  - A bare name with no glob chars and no extension is treated as a directory prefix
*/
function normalizePattern(pattern) {
	if (pattern.startsWith("./")) return pattern.slice(2);
	return pattern;
}
/**
* Check whether a relative path should be ignored by a set of patterns.
*
* Supports:
*  - Directory prefixes: "generated" matches "generated/foo.ts"
*  - Glob-star suffix:   "generated/**" matches "generated/foo.ts"
*  - File globs:         "*.g.dart" matches "lib/foo.g.dart"
*  - Exact paths:        "src/generated/api.d.ts"
*/
function isIgnored(filePath, patterns) {
	for (const raw of patterns) {
		const pattern = normalizePattern(raw);
		if (pattern.endsWith("/**")) {
			const prefix = pattern.slice(0, -3);
			if (filePath === prefix || filePath.startsWith(prefix + "/")) return true;
			continue;
		}
		if (filePath === pattern) return true;
		if (pattern.startsWith("*.")) {
			const ext = pattern.slice(1);
			if (filePath.endsWith(ext)) return true;
			continue;
		}
		if (!pattern.includes("*") && !pattern.includes("/") && !pattern.includes(".")) {
			if (filePath === pattern || filePath.startsWith(pattern + "/")) return true;
			continue;
		}
		if (!pattern.includes("*")) {
			if (filePath.startsWith(pattern + "/") || filePath === pattern) return true;
		}
	}
	return false;
}
/**
* Resolve files in a package directory for lint/format operations.
*
* Walks the package directory recursively, filters to files matching
* the given extensions, and excludes files matching ignore patterns.
*
* @param packageDir — absolute path to the package directory
* @param extensions — file extensions to include (e.g. ['.ts', '.tsx'])
* @param ignorePatterns — patterns from mido.yml lint.ignore / format.ignore
* @returns relative paths from the package root
*/
function resolveFiles(packageDir, extensions, ignorePatterns) {
	const results = [];
	walkDir(packageDir, packageDir, extensions, ignorePatterns, results);
	return results;
}
function walkDir(dir, packageDir, extensions, ignorePatterns, results) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		if (ALWAYS_EXCLUDED.includes(entry)) continue;
		const fullPath = join(dir, entry);
		const rel = relative(packageDir, fullPath);
		let stat;
		try {
			stat = statSync(fullPath);
		} catch {
			continue;
		}
		if (stat.isDirectory()) {
			if (isIgnored(rel, ignorePatterns)) continue;
			walkDir(fullPath, packageDir, extensions, ignorePatterns, results);
			continue;
		}
		if (!stat.isFile()) continue;
		if (!extensions.some((ext) => entry.endsWith(ext))) continue;
		if (isIgnored(rel, ignorePatterns)) continue;
		results.push(rel);
	}
}
//#endregion
//#region src/commands/ecosystem-runner.ts
/** File extensions per ecosystem for file resolution */
const ECOSYSTEM_EXTENSIONS = {
	typescript: [
		".ts",
		".tsx",
		".js",
		".jsx",
		".mjs",
		".cjs"
	],
	dart: [".dart"]
};
/**
* Shared execution engine for lint and format commands.
* Loads config, builds graph, groups packages by ecosystem,
* runs the action in parallel per ecosystem, prints results.
*
* @returns exit code (0 = success, 1 = errors found)
*/
async function runEcosystemCommand(parsers, options, runnerConfig) {
	const { quiet = false } = options;
	const { config, root } = await loadConfig();
	const graph = await buildWorkspaceGraph(config, root, parsers);
	const plugins = loadPlugins();
	const registry = new PluginRegistry(plugins.ecosystem, plugins.domain);
	const pm = detectPackageManager(root);
	const context = registry.createContext(graph, root, pm, config.lint || config.format ? {
		...config.lint ? { lintConfig: config.lint } : {},
		...config.format ? { formatConfig: config.format } : {}
	} : void 0);
	const grouped = groupByEcosystem(graph.packages, options);
	let hasErrors = false;
	for (const [ecosystem, packages] of grouped) {
		if (!quiet) console.log(`\n${DIM}\u25C7${RESET} ${BOLD}${ecosystem}${RESET} ${DIM}(${packages.length} packages)${RESET}`);
		const ignorePatterns = runnerConfig.ignoreSource === "lint" ? config.lint?.ignore ?? [] : config.format?.ignore ?? [];
		const results = await Promise.all(packages.map(async (pkg) => {
			const plugin = registry.getEcosystemForPackage(pkg);
			if (!plugin) return {
				pkg,
				result: {
					success: true,
					duration: 0,
					summary: `No plugin for ecosystem ${pkg.ecosystem}`
				}
			};
			const extensions = ECOSYSTEM_EXTENSIONS[ecosystem];
			const pkgContext = extensions ? {
				...context,
				resolvedFiles: resolveFiles(join(root, pkg.path), extensions, ignorePatterns)
			} : context;
			return {
				pkg,
				result: await plugin.execute(runnerConfig.action, pkg, root, pkgContext)
			};
		}));
		for (const { pkg, result } of results) {
			if (!result.success) hasErrors = true;
			if (quiet && result.success) continue;
			const icon = result.success ? PASS : FAIL;
			console.log(`  ${icon} ${pkg.path}`);
			if (!result.success && result.output) {
				const trimmed = result.output.trim();
				if (trimmed) {
					const indented = trimmed.split("\n").map((line) => `      ${DIM}${line}${RESET}`).join("\n");
					console.log(indented);
				}
			}
		}
	}
	if (!quiet) {
		const icon = hasErrors ? FAIL : PASS;
		const msg = hasErrors ? runnerConfig.summary[1] : runnerConfig.summary[0];
		console.log(`\n${icon} ${msg}\n`);
	}
	return hasErrors ? 1 : 0;
}
//#endregion
export { runEcosystemCommand as t };

//# sourceMappingURL=ecosystem-runner-B-wN-1Bs.js.map