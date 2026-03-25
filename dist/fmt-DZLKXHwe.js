#!/usr/bin/env node
import { i as GREEN, o as RED, r as DIM, s as RESET, t as BOLD } from "./output-D1Xg1ws_.js";
import { t as loadConfig } from "./loader-DEIL81UX.js";
import { t as buildWorkspaceGraph } from "./workspace-B2H5BXLY.js";
import { n as loadPlugins, r as STANDARD_ACTIONS, t as PluginRegistry } from "./registry-2wPMEgE6.js";
import { t as detectPackageManager } from "./pm-detect-wR8KpsCR.js";
import { t as resolveFiles } from "./resolver-C0fej5bN.js";
import { join } from "node:path";
//#region src/commands/fmt.ts
const PASS = `${GREEN}✓${RESET}`;
const FAIL = `${RED}✗${RESET}`;
/** File extensions per ecosystem for format resolution */
const FORMAT_EXTENSIONS = {
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
* Run formatting across all packages in the workspace.
*
* @returns exit code (0 = all formatted, 1 = unformatted files found in check mode)
*/
async function runFmt(parsers, options = {}) {
	const { check = false, quiet = false } = options;
	const { config, root } = await loadConfig();
	const graph = await buildWorkspaceGraph(config, root, parsers);
	const plugins = loadPlugins();
	const registry = new PluginRegistry(plugins.ecosystem, plugins.domain);
	const pm = detectPackageManager(root);
	const context = registry.createContext(graph, root, pm, config.format ? { formatConfig: config.format } : void 0);
	const action = check ? STANDARD_ACTIONS.FORMAT_CHECK : STANDARD_ACTIONS.FORMAT;
	const grouped = groupByEcosystem(graph.packages, options);
	let hasErrors = false;
	for (const [ecosystem, packages] of grouped) {
		if (!quiet) console.log(`\n${DIM}◇${RESET} ${BOLD}${ecosystem}${RESET} ${DIM}(${packages.length} packages)${RESET}`);
		const ignorePatterns = config.format?.ignore ?? [];
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
			const extensions = FORMAT_EXTENSIONS[ecosystem];
			const pkgContext = extensions ? {
				...context,
				resolvedFiles: resolveFiles(join(root, pkg.path), extensions, ignorePatterns)
			} : context;
			return {
				pkg,
				result: await plugin.execute(action, pkg, root, pkgContext)
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
	if (!quiet) console.log(`\n${hasErrors ? FAIL : PASS} ${check ? hasErrors ? "Formatting issues found" : "All files formatted" : hasErrors ? "Formatting failed" : "All formatted"}\n`);
	return hasErrors ? 1 : 0;
}
/** Group packages by ecosystem, applying filters */
function groupByEcosystem(packages, options) {
	const grouped = /* @__PURE__ */ new Map();
	for (const pkg of packages.values()) {
		if (options.package && pkg.path !== options.package) continue;
		if (options.ecosystem && pkg.ecosystem !== options.ecosystem) continue;
		const list = grouped.get(pkg.ecosystem) ?? [];
		list.push(pkg);
		grouped.set(pkg.ecosystem, list);
	}
	return grouped;
}
//#endregion
export { runFmt };

//# sourceMappingURL=fmt-DZLKXHwe.js.map