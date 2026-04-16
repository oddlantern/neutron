import { c as PASS, i as FAIL, r as DIM, t as BOLD, u as RESET } from "./output-DN5bGOyX.js";
import { t as loadConfig } from "./loader-DPbQYX0n.js";
import { i as topologicalSort, t as buildWorkspaceGraph } from "./workspace-MAuyT2B8.js";
import { t as STANDARD_ACTIONS } from "./types-BZtO9wbl.js";
import { t as PluginRegistry } from "./registry-DQ3SZOrN.js";
import { n as formatDiagnostics, t as DiagnosticCollector } from "./diagnostic-B5bXNLTm.js";
import { t as groupByEcosystem } from "./group-Dv9mK0-x.js";
import { t as loadPlugins } from "./loader-D6JoamCp.js";
import { t as detectPackageManager } from "./pm-detect-D6rqJ0No.js";
//#region src/commands/build.ts
const SKIP = `${DIM}·${RESET}`;
const MS_PER_SECOND = 1e3;
/**
* Build a set of package paths that have at least one workspace dependent.
* Packages with dependents are libraries — packages without are apps (leaf nodes).
*/
function findLibraryPaths(packages) {
	const hasDependent = /* @__PURE__ */ new Set();
	for (const pkg of packages.values()) for (const dep of pkg.localDependencies) hasDependent.add(dep);
	return hasDependent;
}
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
	const libraryPaths = options.all ? null : findLibraryPaths(graph.packages);
	const diag = new DiagnosticCollector();
	let builtCount = 0;
	let skippedApps = 0;
	for (const [ecosystem, packages] of grouped) {
		if (!quiet) console.log(`\n${DIM}◇${RESET} ${BOLD}${ecosystem}${RESET} ${DIM}(${packages.length} packages)${RESET}`);
		const pkgPaths = new Set(packages.map((p) => p.path));
		const sortedPackages = topologicalSort(graph.packages, pkgPaths).map((p) => graph.packages.get(p)).filter((p) => p !== void 0);
		for (const pkg of sortedPackages) {
			if (libraryPaths && !libraryPaths.has(pkg.path)) {
				skippedApps++;
				if (!quiet) console.log(`  ${SKIP} ${pkg.path} ${DIM}— app (use --all to include)${RESET}`);
				continue;
			}
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
			if (result.success) builtCount++;
			else {
				const firstLine = result.output?.trim().split("\n")[0] ?? "";
				diag.error(`Build failed: ${pkg.path}`, {
					detail: firstLine,
					fix: `Run neutron build --package ${pkg.path} for full output`
				});
			}
			if (quiet && result.success) continue;
			const icon = result.success ? PASS : FAIL;
			const timing = result.duration > 0 ? ` ${DIM}(${(result.duration / MS_PER_SECOND).toFixed(1)}s)${RESET}` : "";
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
	if (!quiet || diag.hasIssues) {
		const appNote = skippedApps > 0 ? `${DIM}(${skippedApps} app(s) skipped)${RESET}` : "";
		if (appNote) console.log(`\n${appNote}`);
		console.log(formatDiagnostics(diag, builtCount));
	}
	return diag.hasErrors ? 1 : 0;
}
//#endregion
export { runBuild };

//# sourceMappingURL=build-CpwukQO3.js.map