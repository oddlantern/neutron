#!/usr/bin/env node
import { a as GREEN, f as YELLOW, l as RED, n as CYAN, o as MAGENTA, r as DIM, t as BOLD, u as RESET } from "./output-C8Qm-e8m.js";
import { t as loadConfig } from "./loader-Byxz0D__.js";
import { t as buildWorkspaceGraph } from "./workspace-BD6E7qqa.js";
import { n as loadPlugins, t as PluginRegistry } from "./registry-DuRpodRY.js";
import { t as detectPackageManager } from "./pm-detect-CbRmOJLT.js";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import chokidar from "chokidar";
import { createHash } from "node:crypto";
//#region src/watcher/debouncer.ts
const DEFAULT_DELAY_MS = 2e3;
/**
* Create a debouncer that fires the callback after a quiet period.
* Each trigger() call resets the timer. Only fires once per quiet period.
*/
function createDebouncer(callback, delayMs = DEFAULT_DELAY_MS) {
	let timer;
	return {
		trigger() {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = void 0;
				callback();
			}, delayMs);
		},
		cancel() {
			if (timer) {
				clearTimeout(timer);
				timer = void 0;
			}
		}
	};
}
//#endregion
//#region src/watcher/pipeline.ts
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
//#region src/watcher/dev.ts
const CONFIG_FILENAME = "mido.yml";
function formatMs(ms) {
	return ms >= 1e3 ? `${(ms / 1e3).toFixed(1)}s` : `${ms}ms`;
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
	const MAX_OUTPUT_LINES = 15;
	const shown = lines.slice(0, MAX_OUTPUT_LINES);
	for (const line of shown) console.log(`    ${DIM}${line}${RESET}`);
	if (lines.length > MAX_OUTPUT_LINES) console.log(`    ${DIM}... ${lines.length - MAX_OUTPUT_LINES} more line(s)${RESET}`);
}
function logDebug(message) {
	console.log(`  ${MAGENTA}[verbose]${RESET} ${DIM}${message}${RESET}`);
}
async function resolveBridges(bridges, packages, registry, root) {
	const resolved = [];
	for (const bridge of bridges) {
		const source = packages.get(bridge.source);
		if (!source) {
			console.error(`${YELLOW}warn:${RESET} bridge source "${bridge.source}" not found in graph`);
			continue;
		}
		const target = packages.get(bridge.target);
		if (!target) {
			console.error(`${YELLOW}warn:${RESET} bridge target "${bridge.target}" not found in graph`);
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
			targets: [target]
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
			groups.set(`__single__${bridge.bridge.source}__${bridge.bridge.target}`, [bridge]);
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
/**
* Run a pipeline step-by-step, printing progress as each step completes.
*/
async function runPipelineWithProgress(steps, root) {
	const result = await runPipeline(steps, root);
	for (const stepResult of result.steps) printStepResult(stepResult);
	return result;
}
function printResult(result, label) {
	if (result.success) logSuccess(`${label}: synced (${formatMs(result.duration)})`);
	else {
		logFail(`${label}: failed (${formatMs(result.duration)})`);
		if (result.output) logOutput(result.output);
		logWaiting();
	}
}
function matchesBridge(relPath, bridge) {
	for (const pattern of bridge.watchPatterns) {
		const patternBase = pattern.replace(/\/?\*\*.*$/, "");
		if (patternBase && relPath.startsWith(patternBase)) return true;
	}
	return false;
}
/** Resolve watch patterns to base directories for chokidar */
function resolveWatchDirs(resolved, root) {
	const watchDirs = /* @__PURE__ */ new Set();
	for (const r of resolved) for (const pattern of r.watchPatterns) {
		const baseDir = pattern.replace(/\/?\*\*.*$/, "") || ".";
		watchDirs.add(join(root, baseDir));
	}
	return [...watchDirs];
}
/** Tear down an existing watcher session */
function teardownSession(session) {
	for (const debouncer of session.bridgeDebouncers.values()) debouncer.cancel();
	session.configDebouncer.cancel();
	session.watcher.close();
}
/**
* Run the mido dev watcher daemon.
*
* Loads config, builds graph, discovers plugins, watches files,
* and re-runs bridge pipelines on changes. Watches mido.yml and
* reloads everything when the config changes.
*/
async function runDev(parsers, options = {}) {
	const verbose = options.verbose ?? false;
	let session;
	async function startSession() {
		const { config, root } = await loadConfig();
		const graph = await buildWorkspaceGraph(config, root, parsers);
		const pm = detectPackageManager(root);
		if (verbose) {
			logDebug(`workspace root: ${root}`);
			logDebug(`package manager: ${pm}`);
			logDebug(`packages in graph: ${graph.packages.size}`);
		}
		const { ecosystem, domain } = loadPlugins();
		const registry = new PluginRegistry(ecosystem, domain);
		if (graph.bridges.length === 0) {
			console.error(`${YELLOW}warn:${RESET} No bridges defined in mido.yml. Nothing to watch.`);
			return;
		}
		const resolved = await resolveBridges(graph.bridges, graph.packages, registry, root);
		if (resolved.length === 0) {
			console.error(`${RED}error:${RESET} No bridges could be resolved.`);
			return;
		}
		const bridgeWatchDirs = resolveWatchDirs(resolved, root);
		const configPath = join(root, CONFIG_FILENAME);
		const allWatchPaths = [...bridgeWatchDirs, configPath];
		if (verbose) {
			logDebug(`chokidar watching ${allWatchPaths.length} path(s):`);
			for (const p of allWatchPaths) logDebug(`  ${p}`);
		}
		let running = false;
		const pending = /* @__PURE__ */ new Set();
		async function processPending() {
			if (running) return;
			running = true;
			while (pending.size > 0) {
				const batch = [...pending];
				pending.clear();
				const groups = groupBridgesByArtifact(batch);
				for (const group of groups) await executeBridgeGroup(group, registry, graph, root, pm, verbose);
			}
			running = false;
		}
		const bridgeDebouncers = /* @__PURE__ */ new Map();
		for (const r of resolved) {
			const debouncer = createDebouncer(() => {
				if (verbose) logDebug(`debouncer fired for bridge: ${r.bridge.source} \u2192 ${r.bridge.target}`);
				pending.add(r);
				processPending();
			});
			bridgeDebouncers.set(r, debouncer);
		}
		const configDebouncer = createDebouncer(async () => {
			logStep("mido.yml changed — reloading config...");
			if (session) teardownSession(session);
			try {
				const newSession = await startSession();
				if (newSession) {
					session = newSession;
					console.log();
					printBridgeSummary(newSession.resolved, newSession.registry);
					console.log(`  ${DIM}Waiting for changes...${RESET}\n`);
				} else logFail("Config reload failed — no valid bridges. Fix mido.yml and save again.");
			} catch (err) {
				logFail(`Config reload failed: ${err instanceof Error ? err.message : String(err)}`);
				logWaiting();
			}
		}, 500);
		const watcher = chokidar.watch(allWatchPaths, {
			ignoreInitial: true,
			ignored: [
				"**/node_modules/**",
				"**/.dart_tool/**",
				"**/build/**",
				"**/dist/**",
				"**/.symlinks/**"
			],
			awaitWriteFinish: {
				stabilityThreshold: 300,
				pollInterval: 100
			}
		});
		if (verbose) watcher.on("ready", () => {
			logDebug("chokidar ready — watcher initialized");
			const watched = watcher.getWatched();
			let fileCount = 0;
			for (const files of Object.values(watched)) fileCount += files.length;
			logDebug(`chokidar tracking ${Object.keys(watched).length} dir(s), ${fileCount} file(s)`);
		});
		function handleFileEvent(event, filePath) {
			const relPath = relative(root, filePath);
			if (verbose) logDebug(`chokidar ${event}: ${filePath}`);
			if (relPath === CONFIG_FILENAME) {
				if (verbose) logDebug("config file changed — scheduling reload");
				configDebouncer.trigger();
				return;
			}
			logChange(relPath);
			let matched = false;
			for (const r of resolved) if (matchesBridge(relPath, r)) {
				matched = true;
				if (verbose) logDebug(`  matched bridge: ${r.bridge.source} \u2192 ${r.bridge.target} (triggering debouncer)`);
				const debouncer = bridgeDebouncers.get(r);
				if (debouncer) debouncer.trigger();
			}
			if (verbose && !matched) logDebug(`  no bridge matched for ${relPath}`);
		}
		watcher.on("change", (path) => handleFileEvent("change", path));
		watcher.on("add", (path) => handleFileEvent("add", path));
		watcher.on("unlink", (path) => {
			if (verbose) logDebug(`chokidar unlink: ${path}`);
		});
		return {
			watcher,
			bridgeDebouncers,
			configDebouncer,
			resolved,
			graph,
			registry,
			root,
			pm
		};
	}
	session = await startSession();
	if (!session) return 1;
	printStartup(session.resolved, session.registry);
	return new Promise((resolve) => {
		const cleanup = () => {
			console.log(`\n  ${DIM}Shutting down...${RESET}`);
			if (session) teardownSession(session);
			resolve(0);
		};
		process.on("SIGINT", cleanup);
		process.on("SIGTERM", cleanup);
	});
}
//#endregion
export { runDev };

//# sourceMappingURL=dev-xmDgyDP-.js.map