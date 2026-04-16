import { a as GREEN, f as YELLOW, l as RED, r as DIM, s as ORANGE, t as BOLD, u as RESET } from "./output-DN5bGOyX.js";
import { l as USER_AGENT } from "./branding-BIVXTc9K.js";
import { z } from "zod";
//#region src/outdated/collect.ts
/**
* Group workspace dependencies by name + ecosystem.
* Returns the workspace-resolved range (first wins) and which packages use it.
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
* Build a flat map of all workspace dependency ranges keyed by name.
* Used for peer conflict detection.
*/
function buildWorkspaceDepsMap(packages) {
	const map = /* @__PURE__ */ new Map();
	for (const [, pkg] of packages) for (const dep of pkg.dependencies) if (!map.has(dep.name)) map.set(dep.name, dep.range);
	return map;
}
/**
* Check if any Dart package in the workspace has a Flutter dependency.
*/
function hasFlutterDeps(packages) {
	for (const [, pkg] of packages) {
		if (pkg.ecosystem !== "dart") continue;
		for (const dep of pkg.dependencies) if (dep.name === "flutter") return true;
	}
	return false;
}
//#endregion
//#region src/outdated/display.ts
const SEVERITY_COLOR = {
	major: RED,
	minor: YELLOW,
	patch: DIM
};
const SEVERITY_LABEL = {
	major: "MAJOR",
	minor: "MINOR",
	patch: "PATCH"
};
const RISK_CRITICAL_THRESHOLD = 76;
const RISK_HIGH_THRESHOLD = 51;
const RISK_MODERATE_THRESHOLD = 26;
const MAX_ERROR_PREVIEW_LINES = 5;
/** Format a risk score as a colored badge. */
function formatRiskBadge(risk) {
	if (risk.total >= RISK_CRITICAL_THRESHOLD) return `${RED}CRITICAL${RESET}`;
	if (risk.total >= RISK_HIGH_THRESHOLD) return `${ORANGE}HIGH${RESET}`;
	if (risk.total >= RISK_MODERATE_THRESHOLD) return `${YELLOW}MODERATE${RESET}`;
	return `${GREEN}LOW${RESET}`;
}
/** Print Level 1 results to console. */
function formatLevel1Results(outdated) {
	if (outdated.length === 0) {
		console.log(`${GREEN}All dependencies are up to date.${RESET}\n`);
		return;
	}
	const shared = outdated.filter((d) => d.packages.length > 1);
	const single = outdated.filter((d) => d.packages.length === 1);
	function printDep(dep) {
		const color = SEVERITY_COLOR[dep.severity] ?? "\x1B[2m";
		const label = SEVERITY_LABEL[dep.severity] ?? "PATCH";
		const current = stripRange(dep.workspaceRange);
		const badge = formatRiskBadge(dep.risk);
		let line = `  ${color}${label}${RESET} ${BOLD}${dep.name}${RESET} ${DIM}${current} \u2192${RESET} ${color}${dep.latest}${RESET}`;
		line += ` ${DIM}(${dep.ecosystem}, ${dep.packages.length} pkg)${RESET}`;
		line += ` [${badge}]`;
		console.log(line);
		if (dep.metadata.deprecated) console.log(`    ${RED}\u26A0 DEPRECATED: ${dep.metadata.deprecated}${RESET}`);
		if (dep.peerConflicts.length > 0) for (const conflict of dep.peerConflicts) console.log(`    ${YELLOW}\u26A0 peer conflict: ${conflict.peerName} requires ${conflict.requiredRange}, workspace has ${conflict.workspaceRange}${RESET}`);
		if (dep.metadata.changelogUrl) console.log(`    ${DIM}\u2192 ${dep.metadata.changelogUrl}${RESET}`);
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
	const deprecatedCount = outdated.filter((d) => d.metadata.deprecated).length;
	const conflictCount = outdated.filter((d) => d.peerConflicts.length > 0).length;
	console.log(`${DIM}${outdated.length} outdated: ${RED}${majorCount} major${RESET}${DIM}, ${YELLOW}${minorCount} minor${RESET}${DIM}, ${patchCount} patch${RESET}`);
	if (deprecatedCount > 0 || conflictCount > 0) {
		const parts = [];
		if (deprecatedCount > 0) parts.push(`${RED}${deprecatedCount} deprecated${RESET}`);
		if (conflictCount > 0) parts.push(`${YELLOW}${conflictCount} with peer conflicts${RESET}`);
		console.log(`${DIM}${parts.join(", ")}${RESET}`);
	}
}
/** Format outdated results as JSON string. */
function formatJsonOutput(outdated) {
	return JSON.stringify(outdated, null, 2);
}
/** Print Level 2 static analysis results to console. */
function formatLevel2Results(results) {
	if (results.length === 0) {
		console.log(`${DIM}No static analysis results.${RESET}\n`);
		return;
	}
	console.log(`\n${BOLD}Static analysis${RESET} ${DIM}\u2014 approximate API surface diff${RESET}\n`);
	for (const result of results) {
		const dep = result.dep;
		const color = SEVERITY_COLOR[dep.severity] ?? "\x1B[2m";
		console.log(`  ${color}${BOLD}${dep.name}${RESET} ${DIM}${stripRange(dep.workspaceRange)} \u2192 ${dep.latest}${RESET}`);
		if (!result.typeDiff) {
			console.log(`    ${DIM}Could not diff API surface${RESET}`);
			continue;
		}
		const diff = result.typeDiff;
		if (diff.removed.length === 0 && diff.changed.length === 0 && diff.added.length === 0) {
			console.log(`    ${GREEN}No API surface changes detected${RESET}`);
			continue;
		}
		if (diff.added.length > 0) console.log(`    ${GREEN}+${diff.added.length} added${RESET}`);
		if (diff.changed.length > 0) console.log(`    ${YELLOW}~${diff.changed.length} changed${RESET}`);
		if (diff.removed.length > 0) console.log(`    ${RED}-${diff.removed.length} removed${RESET}`);
		if (result.usedRemovedExports.length > 0) {
			console.log(`    ${RED}\u26A0 ${result.usedRemovedExports.length} removed export(s) used in codebase:${RESET}`);
			for (const name of result.usedRemovedExports) console.log(`      ${RED}\u2022 ${name}${RESET}`);
		}
		if (result.usedChangedExports.length > 0) {
			console.log(`    ${YELLOW}\u26A0 ${result.usedChangedExports.length} changed export(s) used in codebase:${RESET}`);
			for (const name of result.usedChangedExports) console.log(`      ${YELLOW}\u2022 ${name}${RESET}`);
		}
		if (result.usedRemovedExports.length === 0 && result.usedChangedExports.length === 0) console.log(`    ${GREEN}None of the changed exports are used in your codebase${RESET}`);
	}
	console.log();
}
/** Print Level 3 live validation results to console. */
function formatLevel3Results(results) {
	if (results.length === 0) {
		console.log(`${DIM}No validation results.${RESET}\n`);
		return;
	}
	console.log(`\n${BOLD}Live validation${RESET} ${DIM}\u2014 typecheck + tests with updated deps${RESET}\n`);
	for (const result of results) {
		const dep = result.dep;
		const tcIcon = result.typecheckPassed ? `${GREEN}\u2713${RESET}` : `${RED}\u2717${RESET}`;
		const testIcon = result.testsPassed ? `${GREEN}\u2713${RESET}` : `${RED}\u2717${RESET}`;
		console.log(`  ${BOLD}${dep.name}${RESET} ${DIM}${stripRange(dep.workspaceRange)} \u2192 ${dep.latest}${RESET}  ${tcIcon} typecheck  ${testIcon} tests`);
		if (!result.typecheckPassed && result.typecheckOutput) {
			const lines = result.typecheckOutput.split("\n").slice(0, MAX_ERROR_PREVIEW_LINES);
			for (const line of lines) console.log(`    ${DIM}${line}${RESET}`);
		}
		if (!result.testsPassed && result.testOutput) {
			const lines = result.testOutput.split("\n").slice(0, MAX_ERROR_PREVIEW_LINES);
			for (const line of lines) console.log(`    ${DIM}${line}${RESET}`);
		}
	}
	console.log();
}
//#endregion
//#region src/outdated/schemas.ts
/** Schema for npm registry version response (GET /{name}/{version}). */
const npmRepositorySchema = z.union([z.object({
	type: z.string().optional(),
	url: z.string()
}), z.string()]);
const npmVersionResponseSchema = z.object({
	version: z.string(),
	deprecated: z.string().optional(),
	peerDependencies: z.record(z.string(), z.string()).optional(),
	repository: npmRepositorySchema.optional(),
	dist: z.object({ tarball: z.string() }).optional()
});
/** Schema for pub.dev package response (GET /api/packages/{name}). */
const pubDevPackageSchema = z.object({ latest: z.object({
	version: z.string(),
	pubspec: z.object({
		name: z.string().optional(),
		dependencies: z.record(z.string(), z.unknown()).optional()
	}).optional()
}) });
/** Safely parse npm version response. Returns null on failure. */
function parseNpmVersion(data) {
	const result = npmVersionResponseSchema.safeParse(data);
	return result.success ? result.data : null;
}
/** Safely parse pub.dev package response. Returns null on failure. */
function parsePubDevPackage(data) {
	const result = pubDevPackageSchema.safeParse(data);
	return result.success ? result.data : null;
}
const pyPiPackageSchema = z.object({
	info: z.object({
		version: z.string(),
		home_page: z.string().nullable().optional(),
		project_url: z.string().nullable().optional()
	}),
	urls: z.array(z.object({
		filename: z.string(),
		url: z.string(),
		packagetype: z.string().optional()
	})).optional()
});
function parsePyPiPackage(data) {
	const result = pyPiPackageSchema.safeParse(data);
	return result.success ? result.data : null;
}
const cratesIoSchema = z.object({
	crate: z.object({
		name: z.string(),
		max_version: z.string(),
		repository: z.string().nullable().optional()
	}),
	versions: z.array(z.object({
		num: z.string(),
		yanked: z.boolean().optional(),
		dl_path: z.string().optional()
	})).optional()
});
function parseCratesIo(data) {
	const result = cratesIoSchema.safeParse(data);
	return result.success ? result.data : null;
}
const goProxySchema = z.object({
	Version: z.string(),
	Time: z.string().optional()
});
function parseGoProxy(data) {
	const result = goProxySchema.safeParse(data);
	return result.success ? result.data : null;
}
const packagistVersionSchema = z.object({
	version: z.string(),
	source: z.object({ url: z.string() }).optional(),
	dist: z.object({ url: z.string() }).optional()
});
const packagistPackageSchema = z.object({ packages: z.record(z.string(), z.array(packagistVersionSchema)) });
function parsePackagist(data) {
	const result = packagistPackageSchema.safeParse(data);
	return result.success ? result.data : null;
}
//#endregion
//#region src/outdated/registry.ts
const NPM_REGISTRY = "https://registry.npmjs.org";
const PUB_DEV_API = "https://pub.dev/api/packages";
const PYPI_API = "https://pypi.org/pypi";
const CRATES_IO_API = "https://crates.io/api/v1/crates";
const GO_PROXY = "https://proxy.golang.org";
const PACKAGIST_API = "https://repo.packagist.org/p2";
const FETCH_TIMEOUT_MS = 5e3;
/**
* Derive a changelog URL from a repository URL.
* Supports GitHub, GitLab, and Bitbucket conventions.
*/
function deriveChangelogUrl(repoUrl) {
	if (!repoUrl) return;
	const cleaned = repoUrl.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/^ssh:\/\/git@github\.com/, "https://github.com").replace(/\.git$/, "");
	try {
		const url = new URL(cleaned);
		if (url.hostname === "github.com") return `${url.origin}${url.pathname}/releases`;
		if (url.hostname === "gitlab.com") return `${url.origin}${url.pathname}/-/releases`;
	} catch {}
}
/**
* Extract the repository URL string from an npm version response.
*/
function extractRepoUrl(parsed) {
	const repo = parsed.repository;
	if (!repo) return;
	if (typeof repo === "string") return repo;
	return repo.url;
}
/**
* Fetch enriched metadata from the npm registry.
* First fetches /latest to get the version, then /{name}/{version} for full metadata.
*/
async function fetchNpmMetadata(name) {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		const res = await fetch(`${NPM_REGISTRY}/${name}/latest`, {
			signal: controller.signal,
			headers: { Accept: "application/json" }
		});
		clearTimeout(timeout);
		if (!res.ok) return null;
		const parsed = parseNpmVersion(await res.json());
		if (!parsed) return null;
		const repoUrl = extractRepoUrl(parsed);
		return {
			latest: parsed.version,
			deprecated: parsed.deprecated,
			peerDependencies: parsed.peerDependencies,
			repositoryUrl: repoUrl,
			tarballUrl: parsed.dist?.tarball,
			changelogUrl: deriveChangelogUrl(repoUrl)
		};
	} catch {
		return null;
	}
}
/**
* Fetch enriched metadata from pub.dev.
*/
async function fetchPubMetadata(name) {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		const res = await fetch(`${PUB_DEV_API}/${name}`, { signal: controller.signal });
		clearTimeout(timeout);
		if (!res.ok) return null;
		const parsed = parsePubDevPackage(await res.json());
		if (!parsed) return null;
		return {
			latest: parsed.latest.version,
			deprecated: void 0,
			peerDependencies: void 0,
			repositoryUrl: void 0,
			tarballUrl: `https://pub.dev/api/archives/${name}-${parsed.latest.version}.tar.gz`,
			changelogUrl: `https://pub.dev/packages/${name}/changelog`
		};
	} catch {
		return null;
	}
}
/**
* Fetch enriched metadata from PyPI.
*/
async function fetchPyPiMetadata(name) {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		const res = await fetch(`${PYPI_API}/${name}/json`, { signal: controller.signal });
		clearTimeout(timeout);
		if (!res.ok) return null;
		const parsed = parsePyPiPackage(await res.json());
		if (!parsed) return null;
		const sdist = parsed.urls?.find((u) => u.packagetype === "sdist");
		const repoUrl = parsed.info.home_page ?? parsed.info.project_url ?? void 0;
		return {
			latest: parsed.info.version,
			deprecated: void 0,
			peerDependencies: void 0,
			repositoryUrl: repoUrl ?? void 0,
			tarballUrl: sdist?.url,
			changelogUrl: deriveChangelogUrl(repoUrl ?? void 0)
		};
	} catch {
		return null;
	}
}
/**
* Fetch enriched metadata from crates.io.
*/
async function fetchCratesMetadata(name) {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		const res = await fetch(`${CRATES_IO_API}/${name}`, {
			signal: controller.signal,
			headers: { "User-Agent": USER_AGENT }
		});
		clearTimeout(timeout);
		if (!res.ok) return null;
		const parsed = parseCratesIo(await res.json());
		if (!parsed) return null;
		const latestVersion = parsed.versions?.find((v) => v.num === parsed.crate.max_version);
		const repoUrl = parsed.crate.repository ?? void 0;
		return {
			latest: parsed.crate.max_version,
			deprecated: latestVersion?.yanked ? "yanked" : void 0,
			peerDependencies: void 0,
			repositoryUrl: repoUrl,
			tarballUrl: latestVersion?.dl_path ? `https://crates.io${latestVersion.dl_path}` : void 0,
			changelogUrl: deriveChangelogUrl(repoUrl)
		};
	} catch {
		return null;
	}
}
/**
* Fetch enriched metadata from the Go module proxy.
*/
async function fetchGoMetadata(modulePath) {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		const res = await fetch(`${GO_PROXY}/${modulePath}/@latest`, { signal: controller.signal });
		clearTimeout(timeout);
		if (!res.ok) return null;
		const parsed = parseGoProxy(await res.json());
		if (!parsed) return null;
		return {
			latest: parsed.Version,
			deprecated: void 0,
			peerDependencies: void 0,
			repositoryUrl: modulePath.startsWith("github.com") ? `https://${modulePath}` : void 0,
			tarballUrl: `${GO_PROXY}/${modulePath}/@v/${parsed.Version}.zip`,
			changelogUrl: modulePath.startsWith("github.com") ? `https://${modulePath}/releases` : void 0
		};
	} catch {
		return null;
	}
}
/**
* Fetch enriched metadata from Packagist (PHP).
*/
async function fetchPackagistMetadata(name) {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		const res = await fetch(`${PACKAGIST_API}/${name}.json`, { signal: controller.signal });
		clearTimeout(timeout);
		if (!res.ok) return null;
		const parsed = parsePackagist(await res.json());
		if (!parsed) return null;
		const versions = parsed.packages[name];
		if (!versions || versions.length === 0) return null;
		const latest = versions[0];
		const repoUrl = latest.source?.url;
		return {
			latest: latest.version,
			deprecated: void 0,
			peerDependencies: void 0,
			repositoryUrl: repoUrl,
			tarballUrl: latest.dist?.url,
			changelogUrl: deriveChangelogUrl(repoUrl)
		};
	} catch {
		return null;
	}
}
/**
* Fetch enriched metadata for a dependency based on its ecosystem.
*/
async function fetchMetadata(name, ecosystem) {
	switch (ecosystem) {
		case "dart": return fetchPubMetadata(name);
		case "python": return fetchPyPiMetadata(name);
		case "rust": return fetchCratesMetadata(name);
		case "go": return fetchGoMetadata(name);
		case "php": return fetchPackagistMetadata(name);
		default: return fetchNpmMetadata(name);
	}
}
//#endregion
//#region src/outdated/risk.ts
const SEVERITY_WEIGHTS = {
	major: 40,
	minor: 15,
	patch: 5
};
const MAX_AFFECTED_SCORE = 20;
const AFFECTED_MULTIPLIER = 5;
const DEPRECATION_PENALTY = 25;
const PEER_CONFLICT_PENALTY = 15;
const MAX_TOTAL = 100;
/**
* Compute a composite risk score for an outdated dependency.
*
* Factors:
* - Severity (major=40, minor=15, patch=5)
* - Affected package count (5 per package, capped at 20)
* - Deprecation (+25 if deprecated)
* - Peer conflicts (+15 if any conflicts exist)
*/
function computeRisk(severity, affectedPackageCount, deprecated, peerConflictCount) {
	const severityScore = SEVERITY_WEIGHTS[severity] ?? 5;
	const affectedScore = Math.min(affectedPackageCount * AFFECTED_MULTIPLIER, MAX_AFFECTED_SCORE);
	const deprecationScore = deprecated ? DEPRECATION_PENALTY : 0;
	const peerScore = peerConflictCount > 0 ? PEER_CONFLICT_PENALTY : 0;
	return {
		total: Math.min(severityScore + affectedScore + deprecationScore + peerScore, MAX_TOTAL),
		severity: severityScore,
		affectedCount: affectedScore,
		deprecation: deprecationScore,
		peerConflicts: peerScore
	};
}
//#endregion
//#region src/outdated/level1.ts
const CONCURRENCY = 10;
/**
* Detect peer dependency conflicts between the updated package's
* peer requirements and the workspace's current dependency ranges.
*/
function detectPeerConflicts(peerDeps, workspaceDeps) {
	if (!peerDeps) return [];
	const conflicts = [];
	for (const [peerName, requiredRange] of Object.entries(peerDeps)) {
		const workspaceRange = workspaceDeps.get(peerName);
		if (!workspaceRange) continue;
		const requiredVersion = stripRange(requiredRange);
		const workspaceVersion = stripRange(workspaceRange);
		const [reqMajor] = requiredVersion.split(".").map(Number);
		const [wsMajor] = workspaceVersion.split(".").map(Number);
		const conflicting = reqMajor !== void 0 && wsMajor !== void 0 && reqMajor !== wsMajor;
		if (conflicting) conflicts.push({
			peerName,
			requiredRange,
			workspaceRange,
			conflicting
		});
	}
	return conflicts;
}
/**
* Run Level 1 analysis: fetch enriched metadata, detect peer conflicts, compute risk scores.
*
* @param deps - Collected workspace dependencies
* @param workspaceDeps - Flat map of all workspace dep name → range (for peer conflict detection)
* @returns Outdated dependencies enriched with metadata, peer conflicts, and risk scores
*/
async function runLevel1(deps, workspaceDeps) {
	const outdated = [];
	let skipped = 0;
	for (let i = 0; i < deps.length; i += CONCURRENCY) {
		const batch = deps.slice(i, i + CONCURRENCY);
		const results = await Promise.all(batch.map(async (dep) => {
			return {
				dep,
				metadata: await fetchMetadata(dep.name, dep.ecosystem)
			};
		}));
		for (const { dep, metadata } of results) {
			if (!metadata) {
				skipped++;
				continue;
			}
			const severity = classifyUpdate(stripRange(dep.range), metadata.latest);
			if (!severity) continue;
			const peerConflicts = detectPeerConflicts(metadata.peerDependencies, workspaceDeps);
			const risk = computeRisk(severity, dep.packages.length, !!metadata.deprecated, peerConflicts.length);
			outdated.push({
				name: dep.name,
				ecosystem: dep.ecosystem,
				workspaceRange: dep.range,
				packages: dep.packages,
				latest: metadata.latest,
				severity,
				metadata,
				peerConflicts,
				risk
			});
		}
	}
	return {
		outdated,
		skipped
	};
}
//#endregion
export { formatLevel2Results as a, buildWorkspaceDepsMap as c, stripRange as d, formatLevel1Results as i, collectDeps as l, SEVERITY_COLOR as n, formatLevel3Results as o, formatJsonOutput as r, formatRiskBadge as s, runLevel1 as t, hasFlutterDeps as u };

//# sourceMappingURL=level1-SvYwHBi_.js.map