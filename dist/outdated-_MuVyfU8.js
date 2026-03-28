#!/usr/bin/env node
import { a as GREEN, f as YELLOW, l as RED, r as DIM, s as ORANGE, t as BOLD, u as RESET } from "./output-MbJ98jNX.js";
import { t as loadConfig } from "./loader-CYxgXRd0.js";
import { t as buildWorkspaceGraph } from "./workspace-22OBPV16.js";
//#region src/commands/outdated.ts
const NPM_REGISTRY = "https://registry.npmjs.org";
const PUB_DEV_API = "https://pub.dev/api/packages";
const FETCH_TIMEOUT_MS = 5e3;
/**
* Group workspace dependencies by name + ecosystem.
* Returns the workspace-resolved range (highest/most common) and which packages use it.
*/
function collectDeps(packages) {
	const map = /* @__PURE__ */ new Map();
	for (const [, pkg] of packages) for (const dep of pkg.dependencies) {
		if (dep.type !== "production") continue;
		const key = `${pkg.ecosystem}::${dep.name}`;
		const existing = map.get(key);
		if (existing) existing.packages.push(pkg.path);
		else map.set(key, {
			range: dep.range,
			packages: [pkg.path],
			ecosystem: pkg.ecosystem
		});
	}
	const result = [];
	for (const [key, val] of map) {
		const name = key.split("::")[1];
		if (name) result.push({
			name,
			ecosystem: val.ecosystem,
			range: val.range,
			packages: val.packages
		});
	}
	return result.sort((a, b) => b.packages.length - a.packages.length);
}
/**
* Strip semver prefix characters to get the raw version.
*/
function stripRange(range) {
	return range.replace(/^[\^~>=<\s]+/, "").split(/\s/)[0] ?? range;
}
/**
* Compare two semver strings and determine the severity of the update.
*/
function classifyUpdate(current, latest) {
	const [cMajor, cMinor] = current.split(".").map(Number);
	const [lMajor, lMinor] = latest.split(".").map(Number);
	if (cMajor === void 0 || cMinor === void 0 || lMajor === void 0 || lMinor === void 0) return null;
	if (lMajor > cMajor) return "major";
	if (lMinor > cMinor) return "minor";
	if (latest !== current) return "patch";
	return null;
}
/**
* Fetch latest version from npm registry.
*/
async function fetchNpmLatest(name) {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		const res = await fetch(`${NPM_REGISTRY}/${name}/latest`, { signal: controller.signal });
		clearTimeout(timeout);
		if (!res.ok) return null;
		return (await res.json()).version ?? null;
	} catch {
		return null;
	}
}
/**
* Fetch latest version from pub.dev.
*/
async function fetchPubLatest(name) {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		const res = await fetch(`${PUB_DEV_API}/${name}`, { signal: controller.signal });
		clearTimeout(timeout);
		if (!res.ok) return null;
		return (await res.json()).latest?.version ?? null;
	} catch {
		return null;
	}
}
/**
* Fetch latest version for a dependency based on its ecosystem.
*/
async function fetchLatest(name, ecosystem) {
	if (ecosystem === "dart") return fetchPubLatest(name);
	return fetchNpmLatest(name);
}
/**
* Check all workspace dependencies against their registries.
*
* @returns exit code (0 = all up to date, 1 = outdated deps found)
*/
async function runOutdated(parsers, options = {}) {
	const { config, root } = await loadConfig();
	const deps = collectDeps((await buildWorkspaceGraph(config, root, parsers)).packages);
	if (deps.length === 0) {
		console.log(`${DIM}No production dependencies found.${RESET}`);
		return 0;
	}
	console.log(`\n${BOLD}mido outdated${RESET} ${DIM}\u2014 checking ${deps.length} dependencies...${RESET}\n`);
	const CONCURRENCY = 10;
	const outdated = [];
	let checked = 0;
	for (let i = 0; i < deps.length; i += CONCURRENCY) {
		const batch = deps.slice(i, i + CONCURRENCY);
		const results = await Promise.all(batch.map(async (dep) => {
			const latest = await fetchLatest(dep.name, dep.ecosystem);
			checked++;
			return {
				dep,
				latest
			};
		}));
		for (const { dep, latest } of results) {
			if (!latest) continue;
			const severity = classifyUpdate(stripRange(dep.range), latest);
			if (severity) outdated.push({
				name: dep.name,
				ecosystem: dep.ecosystem,
				workspaceRange: dep.range,
				packages: dep.packages,
				latest,
				severity
			});
		}
	}
	if (options.json) {
		console.log(JSON.stringify(outdated, null, 2));
		return outdated.length > 0 ? 1 : 0;
	}
	if (outdated.length === 0) {
		console.log(`${GREEN}All ${checked} dependencies are up to date.${RESET}\n`);
		return 0;
	}
	const shared = outdated.filter((d) => d.packages.length > 1);
	const single = outdated.filter((d) => d.packages.length === 1);
	const severityColor = {
		major: RED,
		minor: YELLOW,
		patch: DIM
	};
	const severityLabel = {
		major: "MAJOR",
		minor: "MINOR",
		patch: "PATCH"
	};
	function printDep(dep) {
		const color = severityColor[dep.severity];
		const label = severityLabel[dep.severity];
		const current = stripRange(dep.workspaceRange);
		console.log(`  ${color}${label}${RESET} ${BOLD}${dep.name}${RESET} ${DIM}${current} \u2192${RESET} ${color}${dep.latest}${RESET} ${DIM}(${dep.ecosystem}, ${dep.packages.length} pkg)${RESET}`);
	}
	if (shared.length > 0) {
		console.log(`${ORANGE}${BOLD}Shared dependencies${RESET} ${DIM}(used across multiple packages)${RESET}`);
		for (const dep of shared) printDep(dep);
		console.log();
	}
	if (single.length > 0) {
		console.log(`${BOLD}Other dependencies${RESET}`);
		for (const dep of single) printDep(dep);
		console.log();
	}
	const majorCount = outdated.filter((d) => d.severity === "major").length;
	const minorCount = outdated.filter((d) => d.severity === "minor").length;
	const patchCount = outdated.filter((d) => d.severity === "patch").length;
	console.log(`${DIM}${outdated.length} outdated: ${RED}${majorCount} major${RESET}${DIM}, ${YELLOW}${minorCount} minor${RESET}${DIM}, ${patchCount} patch${RESET}`);
	console.log(`${DIM}Use your package manager to update (bun update, dart pub upgrade).${RESET}`);
	console.log(`${DIM}Then run ${BOLD}mido check${RESET} ${DIM}to verify version consistency.${RESET}\n`);
	return 0;
}
/**
* Quick one-liner check for mido dev startup.
* Returns a summary string or null if all up to date.
*/
async function quickOutdatedCheck(parsers) {
	try {
		const { config, root } = await loadConfig();
		const sharedDeps = collectDeps((await buildWorkspaceGraph(config, root, parsers)).packages).filter((d) => d.packages.length > 1).slice(0, 5);
		if (sharedDeps.length === 0) return null;
		let outdatedCount = 0;
		const results = await Promise.all(sharedDeps.map(async (dep) => {
			const latest = await fetchLatest(dep.name, dep.ecosystem);
			if (!latest) return null;
			return classifyUpdate(stripRange(dep.range), latest) ? dep.name : null;
		}));
		for (const r of results) if (r) outdatedCount++;
		if (outdatedCount === 0) return null;
		return `${outdatedCount} shared dep(s) have updates. Run \`mido outdated\` for details.`;
	} catch {
		return null;
	}
}
//#endregion
export { quickOutdatedCheck, runOutdated };

//# sourceMappingURL=outdated-_MuVyfU8.js.map