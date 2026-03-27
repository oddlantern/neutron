#!/usr/bin/env node
import { a as DIM, f as RESET, o as FAIL, r as BOLD, u as PASS } from "./version-BRfsXVk-.js";
import { t as loadConfig } from "./loader-Co8X4jm-.js";
import { t as buildWorkspaceGraph } from "./workspace-Ba_CMHN8.js";
import { n as loadPlugins, t as PluginRegistry } from "./registry-DhyqY819.js";
import { t as detectPackageManager } from "./pm-detect-mpNBTwyh.js";
import { f as resolveBridges, n as formatMs, r as groupBridgesByArtifact, t as executeBridgeGroup } from "./bridge-runner-DhaM9DyE.js";
//#region src/commands/generate.ts
/**
* Run all bridge pipelines to generate artifacts.
*
* This is the non-watch equivalent of what `mido dev` does on file change —
* it resolves all bridges, groups them by artifact, and executes each pipeline.
* Use after a fresh clone or in CI to produce all generated code.
*
* @returns exit code (0 = all generated, 1 = failure)
*/
async function runGenerate(parsers, options = {}) {
	const { quiet = false, verbose = false } = options;
	const { config, root } = await loadConfig();
	const graph = await buildWorkspaceGraph(config, root, parsers);
	const plugins = loadPlugins();
	const registry = new PluginRegistry(plugins.ecosystem, plugins.domain);
	const pm = detectPackageManager(root);
	const bridges = config.bridges ?? [];
	if (bridges.length === 0) {
		if (!quiet) console.log(`${DIM}No bridges configured — nothing to generate.${RESET}`);
		return 0;
	}
	const resolved = await resolveBridges(bridges, graph.packages, registry, root);
	if (resolved.length === 0) {
		if (!quiet) console.log(`${DIM}No resolvable bridges found.${RESET}`);
		return 0;
	}
	if (!quiet) console.log(`\n${BOLD}mido generate${RESET} ${DIM}— ${resolved.length} bridge(s)${RESET}\n`);
	const groups = groupBridgesByArtifact(resolved);
	let hasErrors = false;
	const start = performance.now();
	for (const group of groups) try {
		await executeBridgeGroup(group, registry, graph, root, pm, verbose);
	} catch (err) {
		hasErrors = true;
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`${FAIL} ${msg}`);
	}
	const duration = Math.round(performance.now() - start);
	if (!quiet) console.log(`\n${hasErrors ? FAIL : PASS} ${resolved.length} bridge(s) processed (${formatMs(duration)})${hasErrors ? " (with errors)" : ""}\n`);
	return hasErrors ? 1 : 0;
}
//#endregion
export { runGenerate };

//# sourceMappingURL=generate-CJ18gJhq.js.map