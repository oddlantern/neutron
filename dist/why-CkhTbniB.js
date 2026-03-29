#!/usr/bin/env node
import { r as DIM, s as ORANGE, t as BOLD, u as RESET } from "./output-MbJ98jNX.js";
import { t as loadConfig } from "./loader-FFG_yaOW.js";
import { t as buildWorkspaceGraph } from "./workspace-D1ScM76h.js";
//#region src/commands/why.ts
/**
* Show why a dependency exists in the workspace — which packages use it,
* version ranges, and dependency types.
*
* @returns exit code (0 = found, 1 = not found)
*/
async function runWhy(parsers, depName, options = {}) {
	const { config, root } = await loadConfig();
	const graph = await buildWorkspaceGraph(config, root, parsers);
	const occurrences = [];
	for (const [, pkg] of graph.packages) for (const dep of pkg.dependencies) if (dep.name === depName) occurrences.push({
		package: pkg.path,
		ecosystem: pkg.ecosystem,
		range: dep.range,
		type: dep.type
	});
	if (occurrences.length === 0) {
		console.log(`${DIM}${depName} is not used in any workspace package.${RESET}`);
		return 1;
	}
	if (options.json) {
		console.log(JSON.stringify({
			name: depName,
			occurrences
		}, null, 2));
		return 0;
	}
	console.log(`\n${BOLD}${depName}${RESET} ${DIM}— used in ${occurrences.length} package(s)${RESET}\n`);
	const byEcosystem = /* @__PURE__ */ new Map();
	for (const occ of occurrences) {
		const existing = byEcosystem.get(occ.ecosystem);
		if (existing) existing.push(occ);
		else byEcosystem.set(occ.ecosystem, [occ]);
	}
	for (const [eco, occs] of byEcosystem) {
		console.log(`  ${ORANGE}${eco}${RESET}`);
		for (const occ of occs) console.log(`    ${occ.package} ${DIM}${occ.range} [${occ.type}]${RESET}`);
	}
	const ranges = new Set(occurrences.map((o) => o.range));
	if (ranges.size > 1) {
		console.log(`\n  ${ORANGE}${BOLD}warning:${RESET} ${ranges.size} different version ranges detected`);
		console.log(`  ${DIM}Run \`mido check --fix\` to resolve${RESET}`);
	}
	console.log();
	return 0;
}
//#endregion
export { runWhy };

//# sourceMappingURL=why-CkhTbniB.js.map