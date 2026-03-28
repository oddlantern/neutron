#!/usr/bin/env node
import { f as YELLOW, l as RED, r as DIM, u as RESET } from "./output-MbJ98jNX.js";
import { t as loadConfig } from "./loader-CYxgXRd0.js";
import { t as buildWorkspaceGraph } from "./workspace-22OBPV16.js";
import { n as loadPlugins, t as PluginRegistry } from "./registry-C8GTLy-v.js";
import { t as detectPackageManager } from "./pm-detect-XlYC3uej.js";
import { a as printStartup, c as logChange, d as logStep, f as logWaiting, i as printBridgeSummary, l as logDebug, n as groupBridgesByArtifact, o as resolveBridges, r as matchesBridge, t as executeBridgeGroup, u as logFail } from "./runner-CY4mswOr.js";
import { t as writeHooks } from "./hooks-BiffFA25.js";
import { join, relative } from "node:path";
import chokidar from "chokidar";
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
//#region src/watcher/dev.ts
const CONFIG_FILENAME = "mido.yml";
const CONFIG_RELOAD_DEBOUNCE_MS = 500;
const CHOKIDAR_STABILITY_THRESHOLD_MS = 300;
const CHOKIDAR_POLL_INTERVAL_MS = 100;
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
				if (verbose) logDebug(`debouncer fired for bridge: ${r.bridge.source} \u2192 [${r.bridge.consumers.join(", ")}]`);
				pending.add(r);
				processPending();
			});
			bridgeDebouncers.set(r, debouncer);
		}
		const configDebouncer = createDebouncer(async () => {
			logStep("mido.yml changed — validating...");
			try {
				await loadConfig();
			} catch (err) {
				logFail(`Invalid config — keeping current session: ${err instanceof Error ? err.message : String(err)}`);
				logWaiting();
				return;
			}
			logStep("config valid — reloading...");
			if (session) teardownSession(session);
			try {
				const newSession = await startSession();
				if (newSession) {
					session = newSession;
					const { config, root: cfgRoot } = await loadConfig();
					await writeHooks(cfgRoot, config, false);
					console.log();
					printBridgeSummary(newSession.resolved, newSession.registry);
					console.log(`  ${DIM}Waiting for changes...${RESET}\n`);
				} else logFail("Config reload failed — no valid bridges. Fix mido.yml and save again.");
			} catch (err) {
				logFail(`Config reload failed: ${err instanceof Error ? err.message : String(err)}`);
				logWaiting();
			}
		}, CONFIG_RELOAD_DEBOUNCE_MS);
		const watcher = chokidar.watch(allWatchPaths, {
			ignoreInitial: true,
			ignored: [
				"**/node_modules/**",
				"**/.dart_tool/**",
				"**/build/**",
				"**/dist/**",
				"**/.symlinks/**",
				"**/generated/**"
			],
			awaitWriteFinish: {
				stabilityThreshold: CHOKIDAR_STABILITY_THRESHOLD_MS,
				pollInterval: CHOKIDAR_POLL_INTERVAL_MS
			}
		});
		if (verbose) watcher.on("ready", () => {
			logDebug("chokidar ready — watcher initialized");
			const watched = watcher.getWatched();
			let fileCount = 0;
			for (const files of Object.values(watched)) fileCount += files.length;
			logDebug(`chokidar tracking ${Object.keys(watched).length} dir(s), ${fileCount} file(s)`);
		});
		/** Paths that should never trigger a bridge rebuild */
		const IGNORED_SEGMENTS = [
			"/generated/",
			"/node_modules/",
			"/.dart_tool/",
			"/build/",
			"/dist/"
		];
		function handleFileEvent(event, filePath) {
			const relPath = relative(root, filePath);
			if (IGNORED_SEGMENTS.some((seg) => relPath.includes(seg.slice(1)) || filePath.includes(seg))) return;
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
				if (verbose) logDebug(`  matched bridge: ${r.bridge.source} \u2192 [${r.bridge.consumers.join(", ")}] (triggering debouncer)`);
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
	setTimeout(() => {
		import("./outdated-Cfa4MzAn.js").then(({ quickOutdatedCheck }) => quickOutdatedCheck(parsers)).then((msg) => {
			if (msg) console.log(`  ${YELLOW}${msg}${RESET}\n`);
		}).catch(() => {});
	}, 3e3);
	return new Promise((resolve) => {
		const cleanup = () => {
			console.log(`\n  ${DIM}Shutting down...${RESET}`);
			if (session) {
				teardownSession(session);
				session = null;
			}
			resolve(0);
			setTimeout(() => process.exit(0), 100);
		};
		process.on("SIGINT", cleanup);
		process.on("SIGTERM", cleanup);
	});
}
//#endregion
export { runDev };

//# sourceMappingURL=dev-Bsd-2X-Z.js.map