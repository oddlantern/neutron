#!/usr/bin/env node
import { c as PASS, i as FAIL, r as DIM, t as BOLD, u as RESET } from "./output-C8Qm-e8m.js";
import { t as loadConfig } from "./loader-Bk5qGav2.js";
import { t as groupByEcosystem } from "./group-DOIW_El-.js";
import { t as buildWorkspaceGraph } from "./workspace-Bcx1iS1C.js";
import { n as loadPlugins, r as STANDARD_ACTIONS, t as PluginRegistry } from "./registry-C3TQvbGO.js";
import { t as detectPackageManager } from "./pm-detect-mpNBTwyh.js";
//#region src/commands/build.ts
const SKIP = `${DIM}·${RESET}`;
/**
* Run builds across all packages in the workspace.
*
* @returns exit code (0 = all built, 1 = build failure)
*/
async function runBuild(parsers, options = {}) {
	const { quiet = false } = options;
	const { config, root } = await loadConfig();
	const graph = await buildWorkspaceGraph(config, root, parsers);
	const plugins = loadPlugins();
	const registry = new PluginRegistry(plugins.ecosystem, plugins.domain);
	const pm = detectPackageManager(root);
	const context = registry.createContext(graph, root, pm);
	const grouped = groupByEcosystem(graph.packages, options);
	let hasErrors = false;
	let builtCount = 0;
	for (const [ecosystem, packages] of grouped) {
		if (!quiet) console.log(`\n${DIM}◇${RESET} ${BOLD}${ecosystem}${RESET} ${DIM}(${packages.length} packages)${RESET}`);
		for (const pkg of packages) {
			const plugin = registry.getEcosystemForPackage(pkg);
			if (!plugin) {
				if (!quiet) console.log(`  ${SKIP} ${pkg.path} ${DIM}— no plugin${RESET}`);
				continue;
			}
			if (!(await plugin.getActions(pkg, root)).includes(STANDARD_ACTIONS.BUILD)) {
				if (!quiet) console.log(`  ${SKIP} ${pkg.path} ${DIM}— no build action${RESET}`);
				continue;
			}
			const result = await plugin.execute(STANDARD_ACTIONS.BUILD, pkg, root, context);
			if (!result.success) hasErrors = true;
			else builtCount++;
			if (quiet && result.success) continue;
			const icon = result.success ? PASS : FAIL;
			const timing = result.duration > 0 ? ` ${DIM}(${(result.duration / 1e3).toFixed(1)}s)${RESET}` : "";
			console.log(`  ${icon} ${pkg.path}${timing}`);
			if (!result.success && result.output) {
				const trimmed = result.output.trim();
				if (trimmed) {
					const indented = trimmed.split("\n").map((line) => `      ${DIM}${line}${RESET}`).join("\n");
					console.log(indented);
				}
			}
		}
	}
	if (!quiet) console.log(`\n${hasErrors ? FAIL : PASS} ${builtCount} package(s) built${hasErrors ? " (with errors)" : ""}\n`);
	return hasErrors ? 1 : 0;
}
//#endregion
export { runBuild };

//# sourceMappingURL=build-TzG_43RJ.js.map