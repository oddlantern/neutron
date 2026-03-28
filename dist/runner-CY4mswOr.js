#!/usr/bin/env node
import { a as GREEN, f as YELLOW, l as RED, n as CYAN, o as MAGENTA, r as DIM, t as BOLD, u as RESET } from "./output-MbJ98jNX.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
//#region src/bridges/pipeline.ts
/**
* Hash a file's contents. Returns empty string if the file doesn't exist.
*/
async function hashFile(filePath) {
	try {
		const content = await readFile(filePath);
		return createHash("sha256").update(content).digest("hex");
	} catch {
		return "";
	}
}
/**
* Hash all output files for a step. Returns a map of path → hash.
*/
async function hashOutputFiles(root, paths) {
	const hashes = /* @__PURE__ */ new Map();
	for (const relPath of paths) {
		const hash = await hashFile(join(root, relPath));
		hashes.set(relPath, hash);
	}
	return hashes;
}
/**
* Compare before/after hashes to detect changes.
* Treats files that don't exist in either snapshot as "changed"
* (the step was expected to create them but didn't).
*/
function hasChanges(before, after) {
	for (const [path, beforeHash] of before) {
		const afterHash = after.get(path) ?? "";
		if (!beforeHash && !afterHash) return true;
		if (afterHash !== beforeHash) return true;
	}
	return false;
}
/**
* Execute a pipeline of steps sequentially.
*
* - Each step runs after the previous one succeeds
* - If a step fails, the pipeline stops immediately
* - Output files are hashed before/after each step for change detection
* - Returns a full result with per-step timing and change status
*/
async function runPipeline(steps, root) {
	const results = [];
	let totalDuration = 0;
	for (const step of steps) {
		const beforeHashes = step.outputPaths ? await hashOutputFiles(root, step.outputPaths) : /* @__PURE__ */ new Map();
		const result = await step.execute();
		totalDuration += result.duration;
		const afterHashes = step.outputPaths ? await hashOutputFiles(root, step.outputPaths) : /* @__PURE__ */ new Map();
		const changed = step.outputPaths ? hasChanges(beforeHashes, afterHashes) : true;
		results.push({
			step,
			success: result.success,
			duration: result.duration,
			output: result.output,
			changed
		});
		if (!result.success) return {
			success: false,
			totalDuration,
			steps: results
		};
	}
	return {
		success: true,
		totalDuration,
		steps: results
	};
}
//#endregion
//#region src/bridges/logger.ts
const MS_PER_SECOND = 1e3;
const MAX_OUTPUT_LINES = 15;
function formatMs(ms) {
	return ms >= MS_PER_SECOND ? `${(ms / MS_PER_SECOND).toFixed(1)}s` : `${ms}ms`;
}
function log(icon, message) {
	console.log(`  ${icon} ${message}`);
}
function logStep(message) {
	log(`${DIM}\u25C7${RESET}`, `${DIM}${message}${RESET}`);
}
function logSuccess(message) {
	log(`${GREEN}\u2713${RESET}`, `${GREEN}${message}${RESET}`);
}
function logFail(message) {
	log(`${RED}\u2717${RESET}`, `${RED}${message}${RESET}`);
}
function logChange(path) {
	log(`${CYAN}\u25CB${RESET}`, `changes in ${DIM}${path}${RESET}`);
}
function logWaiting() {
	log(`${DIM}\u2298${RESET}`, `${DIM}waiting for next change...${RESET}`);
}
function logUnchanged(message) {
	log(`${DIM}\u00B7${RESET}`, `${DIM}${message}${RESET}`);
}
function logOutput(output) {
	const lines = output.trim().split("\n");
	const shown = lines.slice(0, MAX_OUTPUT_LINES);
	for (const line of shown) console.log(`    ${DIM}${line}${RESET}`);
	if (lines.length > MAX_OUTPUT_LINES) console.log(`    ${DIM}... ${lines.length - MAX_OUTPUT_LINES} more line(s)${RESET}`);
}
function logDebug(message) {
	console.log(`  ${MAGENTA}[verbose]${RESET} ${DIM}${message}${RESET}`);
}
//#endregion
//#region src/bridges/runner.ts
async function resolveBridges(bridges, packages, registry, root) {
	const resolved = [];
	for (const bridge of bridges) {
		const source = packages.get(bridge.source);
		if (!source) {
			console.error(`${YELLOW}warn:${RESET} bridge source "${bridge.source}" not found in graph`);
			continue;
		}
		const targets = [];
		for (const consumerPath of bridge.consumers) {
			const consumer = packages.get(consumerPath);
			if (!consumer) {
				console.error(`${YELLOW}warn:${RESET} bridge consumer "${consumerPath}" not found in graph`);
				continue;
			}
			targets.push(consumer);
		}
		if (targets.length === 0) {
			console.error(`${YELLOW}warn:${RESET} bridge ${bridge.source} has no resolvable consumers`);
			continue;
		}
		const domain = await registry.getDomainForArtifact(bridge.artifact, root);
		const sourcePlugin = registry.getEcosystemForPackage(source);
		let watchPatterns;
		if (bridge.watch?.length) watchPatterns = bridge.watch;
		else watchPatterns = [join(source.path, "**")];
		resolved.push({
			bridge,
			watchPatterns,
			domain,
			sourcePlugin,
			source,
			targets
		});
	}
	return resolved;
}
function printBridgeSummary(resolved, registry) {
	for (const r of resolved) {
		const artifact = r.bridge.artifact;
		const sourceLabel = r.source.path;
		const targetLabels = r.targets.map((t) => t.path).join(", ");
		const watchLabels = r.watchPatterns.join(", ");
		if (r.domain) {
			const plugins = [`mido-${r.domain.name}`];
			if (r.sourcePlugin) plugins.push(`mido-${r.sourcePlugin.name}`);
			for (const t of r.targets) {
				const eco = registry.getEcosystemForPackage(t);
				if (eco && !plugins.includes(`mido-${eco.name}`)) plugins.push(`mido-${eco.name}`);
			}
			console.log(`  ${BOLD}${r.domain.name}:${RESET} ${sourceLabel} \u2192 ${artifact}`);
			console.log(`    ${DIM}watching: ${watchLabels}${RESET}`);
			console.log(`    ${DIM}targets: ${targetLabels}${RESET}`);
			console.log(`    ${DIM}plugins: ${plugins.join(", ")}${RESET}`);
		} else if (r.bridge.run) {
			console.log(`  ${BOLD}bridge:${RESET} ${sourceLabel} \u2192 ${artifact}`);
			console.log(`    ${DIM}watching: ${watchLabels}${RESET}`);
			console.log(`    ${DIM}run: ${r.bridge.run}${RESET}`);
		} else if (r.sourcePlugin) {
			console.log(`  ${BOLD}${r.sourcePlugin.name}:${RESET} ${sourceLabel} \u2192 ${artifact}`);
			console.log(`    ${DIM}watching: ${watchLabels}${RESET}`);
			console.log(`    ${DIM}targets: ${targetLabels}${RESET}`);
		} else {
			console.log(`  ${YELLOW}${BOLD}unmatched:${RESET} ${artifact}`);
			console.log(`    ${YELLOW}No plugin found \u2014 add run: <script> to this bridge${RESET}`);
		}
		console.log();
	}
}
function printStartup(resolved, registry) {
	console.log(`\n${CYAN}${BOLD}mido dev${RESET} ${DIM}\u2014 watching ${resolved.length} bridge(s)${RESET}\n`);
	printBridgeSummary(resolved, registry);
	console.log(`  ${DIM}Waiting for changes...${RESET}\n`);
}
function printStepResult(stepResult) {
	if (!stepResult.success) {
		logFail(`${stepResult.step.description.replace(/\.\.\.$/, "")} failed (${formatMs(stepResult.duration)})`);
		if (stepResult.output) logOutput(stepResult.output);
		return;
	}
	if (!stepResult.changed) {
		logUnchanged(`${stepResult.step.description.replace(/\.\.\.$/, "")} \u2014 unchanged`);
		return;
	}
	logSuccess(`${stepResult.step.description.replace(/\.\.\.$/, "")} (${formatMs(stepResult.duration)})`);
}
function printResult(result, label) {
	if (result.success) logSuccess(`${label}: synced (${formatMs(result.duration)})`);
	else {
		logFail(`${label}: failed (${formatMs(result.duration)})`);
		if (result.output) logOutput(result.output);
		logWaiting();
	}
}
/**
* Run a pipeline step-by-step, printing progress as each step completes.
*/
async function runPipelineWithProgress(steps, root) {
	const result = await runPipeline(steps, root);
	for (const stepResult of result.steps) printStepResult(stepResult);
	return result;
}
/**
* Execute a single bridge (no artifact grouping).
*/
async function executeBridge(resolved, registry, graph, root, pm, verbose) {
	const bridge = resolved.bridge;
	const context = registry.createContext(graph, root, pm, { verbose });
	if (bridge.run && resolved.sourcePlugin) {
		logStep(`running "${bridge.run}" on ${resolved.source.name}...`);
		printResult(await resolved.sourcePlugin.execute(bridge.run, resolved.source, root, context), `${bridge.source} bridge`);
		return;
	}
	if (resolved.domain) {
		if (resolved.domain.buildPipeline) {
			const steps = await resolved.domain.buildPipeline(resolved.source, bridge.artifact, resolved.targets, root, context);
			if (steps.length > 0) {
				const pipelineResult = await runPipelineWithProgress(steps, root);
				if (pipelineResult.success) {
					const stepCount = pipelineResult.steps.length;
					logSuccess(`${resolved.domain.name} bridge: synced (${formatMs(pipelineResult.totalDuration)}) — ${stepCount} step(s)`);
				} else logWaiting();
				return;
			}
		}
		logStep(`mido-${resolved.domain.name}: exporting spec...`);
		const exportResult = await resolved.domain.exportArtifact(resolved.source, bridge.artifact, root, context);
		if (!exportResult.success) {
			logFail(`export failed (${formatMs(exportResult.duration)})`);
			if (exportResult.output) logOutput(exportResult.output);
			logWaiting();
			return;
		}
		logSuccess(`${bridge.artifact} updated (${formatMs(exportResult.duration)})`);
		if (resolved.targets.length > 0) {
			const downstreamResults = await resolved.domain.generateDownstream(bridge.artifact, resolved.targets, root, context);
			let totalDuration = exportResult.duration;
			let allSuccess = true;
			for (const result of downstreamResults) {
				totalDuration += result.duration;
				if (result.success) logSuccess(`${result.summary} (${formatMs(result.duration)})`);
				else {
					logFail(`${result.summary} (${formatMs(result.duration)})`);
					allSuccess = false;
				}
			}
			if (allSuccess) logSuccess(`${resolved.domain.name} bridge: synced (${formatMs(totalDuration)})`);
		}
		return;
	}
	if (resolved.sourcePlugin) {
		const actions = await resolved.sourcePlugin.getActions(resolved.source, root);
		const action = actions.includes("generate") ? "generate" : actions[0];
		if (!action) {
			logFail(`no actions available for ${resolved.source.name}`);
			logWaiting();
			return;
		}
		logStep(`mido-${resolved.sourcePlugin.name}: running "${action}"...`);
		printResult(await resolved.sourcePlugin.execute(action, resolved.source, root, context), `${resolved.source.path} bridge`);
		return;
	}
	logFail(`No plugin found for ${bridge.artifact} — add run: <script> to this bridge`);
	logWaiting();
}
/**
* Group bridges by artifact path. When multiple bridges share the same artifact
* and domain plugin, merge their targets and execute once (single validation,
* parallel generation). Non-grouped bridges execute individually.
*/
function groupBridgesByArtifact(bridges) {
	const groups = /* @__PURE__ */ new Map();
	for (const bridge of bridges) {
		if (!bridge.domain?.buildPipeline) {
			groups.set(`__single__${bridge.bridge.source}__${bridge.bridge.consumers.join(",")}`, [bridge]);
			continue;
		}
		const key = `${bridge.bridge.artifact}::${bridge.domain.name}`;
		const existing = groups.get(key);
		if (existing) existing.push(bridge);
		else groups.set(key, [bridge]);
	}
	return [...groups.values()];
}
/**
* Execute a group of bridges that share the same artifact.
* Merges targets from all bridges and runs a single pipeline.
*/
async function executeBridgeGroup(group, registry, graph, root, pm, verbose) {
	const first = group[0];
	if (!first) return;
	if (group.length === 1) {
		await executeBridge(first, registry, graph, root, pm, verbose);
		return;
	}
	const domain = first.domain;
	if (!domain?.buildPipeline) {
		for (const bridge of group) await executeBridge(bridge, registry, graph, root, pm, verbose);
		return;
	}
	const mergedTargets = [];
	for (const bridge of group) mergedTargets.push(...bridge.targets);
	const context = registry.createContext(graph, root, pm, { verbose });
	if (verbose) {
		const targetNames = mergedTargets.map((t) => t.path).join(", ");
		logDebug(`grouped ${group.length} bridges for artifact ${first.bridge.artifact} → [${targetNames}]`);
	}
	const steps = await domain.buildPipeline(first.source, first.bridge.artifact, mergedTargets, root, context);
	if (steps.length > 0) {
		const pipelineResult = await runPipelineWithProgress(steps, root);
		if (pipelineResult.success) {
			const stepCount = pipelineResult.steps.length;
			logSuccess(`${domain.name} bridge: synced (${formatMs(pipelineResult.totalDuration)}) — ${stepCount} step(s)`);
		} else logWaiting();
		return;
	}
	for (const bridge of group) await executeBridge(bridge, registry, graph, root, pm, verbose);
}
function matchesBridge(relPath, bridge) {
	for (const pattern of bridge.watchPatterns) {
		const patternBase = pattern.replace(/\/?\*\*.*$/, "");
		if (patternBase && relPath.startsWith(patternBase)) return true;
	}
	return false;
}
//#endregion
export { printStartup as a, logChange as c, logStep as d, logWaiting as f, printBridgeSummary as i, logDebug as l, groupBridgesByArtifact as n, resolveBridges as o, matchesBridge as r, formatMs as s, executeBridgeGroup as t, logFail as u };

//# sourceMappingURL=runner-CY4mswOr.js.map