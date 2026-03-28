#!/usr/bin/env node
import { r as DIM, s as ORANGE, t as BOLD, u as RESET } from "./output-MbJ98jNX.js";
import { t as loadConfig } from "./loader-CYxgXRd0.js";
import { t as buildWorkspaceGraph } from "./workspace-22OBPV16.js";
import { spawnSync } from "node:child_process";
//#region src/commands/affected.ts
/**
* Get the list of files changed between base ref and HEAD.
*/
function getChangedFiles(root, base) {
	try {
		const result = spawnSync("git", [
			"diff",
			"--name-only",
			base,
			"HEAD"
		], {
			cwd: root,
			encoding: "utf-8"
		});
		if (result.status !== 0) return [];
		return (result.stdout ?? "").trim().split("\n").filter((line) => line.length > 0);
	} catch {
		return [];
	}
}
/** Path segments that indicate generated/non-source files */
const IGNORED_SEGMENTS = [
	"/generated/",
	"/node_modules/",
	"/.dart_tool/",
	"/build/",
	"/dist/"
];
/**
* Map changed files to the packages they belong to.
* Filters out generated output and other non-source paths.
*/
function filesToPackages(changedFiles, packages) {
	const affected = /* @__PURE__ */ new Set();
	for (const file of changedFiles) {
		if (IGNORED_SEGMENTS.some((seg) => file.includes(seg.slice(1)))) continue;
		for (const [path] of packages) if (file.startsWith(path + "/") || file === path) affected.add(path);
	}
	return affected;
}
/**
* Build a reverse dependency map: for each package, which packages depend on it.
*/
function buildReverseDeps(packages) {
	const reverse = /* @__PURE__ */ new Map();
	for (const [, pkg] of packages) for (const dep of pkg.localDependencies) {
		const existing = reverse.get(dep);
		if (existing) existing.push(pkg.path);
		else reverse.set(dep, [pkg.path]);
	}
	return reverse;
}
/**
* Build a reverse bridge map: for each source, which packages consume its artifacts.
*/
function buildReverseBridges(bridges) {
	const reverse = /* @__PURE__ */ new Map();
	for (const bridge of bridges) {
		const existing = reverse.get(bridge.source);
		const consumers = [...bridge.consumers];
		if (existing) {
			for (const c of consumers) if (!existing.includes(c)) existing.push(c);
		} else reverse.set(bridge.source, consumers);
	}
	return reverse;
}
/**
* Walk the graph forward from a set of directly changed packages,
* following both dependency edges and bridge edges.
*/
function walkForward(directlyChanged, reverseDeps, reverseBridges) {
	const affected = new Set(directlyChanged);
	const queue = [...directlyChanged];
	while (queue.length > 0) {
		const current = queue.pop();
		if (!current) break;
		const dependents = reverseDeps.get(current);
		if (dependents) {
			for (const dep of dependents) if (!affected.has(dep)) {
				affected.add(dep);
				queue.push(dep);
			}
		}
		const bridgeConsumers = reverseBridges.get(current);
		if (bridgeConsumers) {
			for (const consumer of bridgeConsumers) if (!affected.has(consumer)) {
				affected.add(consumer);
				queue.push(consumer);
			}
		}
	}
	return affected;
}
/**
* Determine which packages are affected by changes since a base ref.
*
* Algorithm:
* 1. git diff → changed files
* 2. Map files → packages (direct changes)
* 3. Walk forward through dependency graph + bridge edges
* 4. Output affected package paths
*
* @returns exit code (0 = success)
*/
async function runAffected(parsers, options = {}) {
	const base = options.base ?? "HEAD~1";
	const { config, root } = await loadConfig();
	const graph = await buildWorkspaceGraph(config, root, parsers);
	const changedFiles = getChangedFiles(root, base);
	if (changedFiles.length === 0) {
		if (options.json) console.log("[]");
		return 0;
	}
	const directlyChanged = filesToPackages(changedFiles, graph.packages);
	const sorted = [...walkForward(directlyChanged, buildReverseDeps(graph.packages), buildReverseBridges(graph.bridges))].sort();
	if (options.json) {
		console.log(JSON.stringify(sorted, null, 2));
		return 0;
	}
	if (sorted.length === 0) {
		console.log(`${DIM}No workspace packages affected.${RESET}`);
		return 0;
	}
	console.log(`\n${BOLD}mido affected${RESET} ${DIM}— ${sorted.length} package(s) affected since ${base}${RESET}\n`);
	for (const path of sorted) {
		const marker = directlyChanged.has(path) ? `${ORANGE}*${RESET}` : `${DIM}→${RESET}`;
		const pkg = graph.packages.get(path);
		const eco = pkg ? ` ${DIM}(${pkg.ecosystem})${RESET}` : "";
		console.log(`  ${marker} ${path}${eco}`);
	}
	const directCount = [...sorted].filter((p) => directlyChanged.has(p)).length;
	const transitiveCount = sorted.length - directCount;
	console.log(`\n${DIM}${directCount} direct, ${transitiveCount} transitive${RESET}\n`);
	return 0;
}
//#endregion
export { runAffected };

//# sourceMappingURL=affected-1H_7z3JH.js.map