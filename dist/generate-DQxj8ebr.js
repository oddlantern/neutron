#!/usr/bin/env node
import { r as isRecord } from "./version-M9xRTj7S.js";
import { c as PASS, i as FAIL, r as DIM, t as BOLD, u as RESET } from "./output-MbJ98jNX.js";
import { t as loadConfig } from "./loader-CYxgXRd0.js";
import { t as buildWorkspaceGraph } from "./workspace-22OBPV16.js";
import { n as loadPlugins, t as PluginRegistry } from "./registry-BrU4OPPH.js";
import { t as detectPackageManager } from "./pm-detect-XlYC3uej.js";
import { d as logStep, n as groupBridgesByArtifact, o as resolveBridges, s as formatMs, t as executeBridgeGroup } from "./runner-CY4mswOr.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
//#region src/bridges/cache.ts
const CACHE_DIR = "node_modules/.cache/mido";
const CACHE_FILE = "pipeline-cache.json";
function getCachePath(root) {
	return join(root, CACHE_DIR, CACHE_FILE);
}
function isCacheEntry(value) {
	if (!isRecord(value)) return false;
	return typeof value["inputHash"] === "string" && typeof value["timestamp"] === "number";
}
function readCache(root) {
	const cachePath = getCachePath(root);
	if (!existsSync(cachePath)) return {};
	try {
		const raw = readFileSync(cachePath, "utf-8");
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || !parsed) return {};
		const result = {};
		for (const [key, value] of Object.entries(parsed)) if (isCacheEntry(value)) result[key] = value;
		return result;
	} catch {}
	return {};
}
function writeCache(root, data) {
	mkdirSync(join(root, CACHE_DIR), { recursive: true });
	writeFileSync(getCachePath(root), JSON.stringify(data, null, 2) + "\n", "utf-8");
}
/**
* Hash the contents of a single file.
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
* Compute a combined hash for a bridge's inputs:
* - The artifact file itself
* - All files matching the watch patterns
*/
async function computeInputHash(root, artifact, watchPatterns) {
	const hash = createHash("sha256");
	const artifactHash = await hashFile(join(root, artifact));
	hash.update(`artifact:${artifact}:${artifactHash}`);
	for (const pattern of watchPatterns) {
		const absDir = join(root, pattern.replace(/\/?\*\*.*$/, ""));
		if (!existsSync(absDir)) continue;
		const files = collectFiles(absDir);
		for (const file of files.sort()) {
			const fileHash = await hashFile(file);
			if (fileHash) {
				const relPath = file.slice(root.length + 1);
				hash.update(`${relPath}:${fileHash}`);
			}
		}
	}
	return hash.digest("hex");
}
/**
* Recursively collect all files in a directory (sync, for simplicity).
*/
function collectFiles(dir) {
	const results = [];
	try {
		const entries = readdirSync(dir);
		for (const entry of entries) {
			if (entry === "node_modules" || entry === ".dart_tool" || entry === "build" || entry === "dist" || entry === ".git") continue;
			const fullPath = join(dir, entry);
			try {
				if (statSync(fullPath).isDirectory()) results.push(...collectFiles(fullPath));
				else results.push(fullPath);
			} catch {}
		}
	} catch {}
	return results;
}
/**
* Check if a bridge's inputs have changed since the last successful run.
* Returns true if the pipeline should be skipped (cache hit).
*/
async function isCacheHit(root, bridgeKey, artifact, watchPatterns) {
	const entry = readCache(root)[bridgeKey];
	if (!entry) return false;
	const currentHash = await computeInputHash(root, artifact, watchPatterns);
	return entry.inputHash === currentHash;
}
/**
* Update the cache after a successful pipeline run.
*/
async function updateCache(root, bridgeKey, artifact, watchPatterns) {
	const cache = readCache(root);
	cache[bridgeKey] = {
		inputHash: await computeInputHash(root, artifact, watchPatterns),
		timestamp: Date.now()
	};
	writeCache(root, cache);
}
//#endregion
//#region src/commands/generate.ts
/**
* Run all bridge pipelines to generate artifacts.
*
* Uses an input hash cache to skip unchanged bridges. Pass --force to regenerate everything.
*
* @returns exit code (0 = all generated, 1 = failure)
*/
async function runGenerate(parsers, options = {}) {
	const { quiet = false, verbose = false, force = false } = options;
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
	let skipped = 0;
	const start = performance.now();
	for (const group of groups) {
		const first = group[0];
		if (!first) continue;
		const bridgeKey = `${first.bridge.source}::${first.bridge.artifact}`;
		if (!force) {
			const cached = await isCacheHit(root, bridgeKey, first.bridge.artifact, first.watchPatterns);
			const outputMissing = first.targets.some((t) => {
				return !existsSync(join(root, first.bridge.source, "generated", t.ecosystem));
			});
			if (cached && !outputMissing) {
				skipped++;
				if (!quiet && verbose) logStep(`${first.bridge.artifact} — cached, skipping`);
				continue;
			}
		}
		try {
			await executeBridgeGroup(group, registry, graph, root, pm, verbose);
			if (group.every((r) => r.targets.every((t) => existsSync(join(root, r.bridge.source, "generated", t.ecosystem))))) await updateCache(root, bridgeKey, first.bridge.artifact, first.watchPatterns);
		} catch (err) {
			hasErrors = true;
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`${FAIL} ${msg}`);
		}
	}
	const duration = Math.round(performance.now() - start);
	if (!quiet) {
		const icon = hasErrors ? FAIL : PASS;
		const skipNote = skipped > 0 ? ` ${DIM}(${skipped} cached)${RESET}` : "";
		console.log(`\n${icon} ${resolved.length} bridge(s) processed (${formatMs(duration)})${hasErrors ? " (with errors)" : ""}${skipNote}\n`);
	}
	return hasErrors ? 1 : 0;
}
//#endregion
export { runGenerate };

//# sourceMappingURL=generate-DQxj8ebr.js.map