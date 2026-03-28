#!/usr/bin/env node
import { join } from "node:path";
import { existsSync } from "node:fs";
//#region src/checks/staleness.ts
const CHECK_NAME = "staleness";
/**
* Check whether generated output directories exist for all bridges.
* All bridges should produce `<source>/generated/<ecosystem>/`.
*
* Reports warnings (not errors) — doesn't block pre-commit or CI.
*/
async function checkStaleness(graph, root) {
	const issues = [];
	const bridgeOutputs = collectBridgeOutputs(graph.bridges, graph.packages);
	if (bridgeOutputs.length === 0) return {
		check: CHECK_NAME,
		passed: true,
		summary: "no bridge outputs to check",
		issues: []
	};
	let presentCount = 0;
	for (const output of bridgeOutputs) if (existsSync(join(root, output.source, "generated", output.ecosystem))) presentCount++;
	else issues.push({
		severity: "warning",
		check: CHECK_NAME,
		message: `${output.source}/generated/${output.ecosystem}/ missing — run \`mido generate\``
	});
	return {
		check: CHECK_NAME,
		passed: true,
		summary: issues.length > 0 ? `${issues.length} generated output(s) missing` : `${presentCount} generated output(s) present`,
		issues
	};
}
function collectBridgeOutputs(bridges, packages) {
	const seen = /* @__PURE__ */ new Set();
	const outputs = [];
	for (const bridge of bridges) for (const consumer of bridge.consumers) {
		const pkg = packages.get(consumer);
		if (!pkg) continue;
		const key = `${bridge.source}::${pkg.ecosystem}`;
		if (!seen.has(key)) {
			seen.add(key);
			outputs.push({
				source: bridge.source,
				ecosystem: pkg.ecosystem
			});
		}
	}
	return outputs;
}
//#endregion
export { checkStaleness };

//# sourceMappingURL=staleness-COmJngf2.js.map