import { t as __exportAll } from "./rolldown-runtime-CiIaOW0V.js";
import { join, relative, resolve } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
//#region src/graph/glob.ts
/**
* Expand package path patterns that contain `*` wildcards.
* Supports single-level `*` expansion (e.g., `apps/*`, `packages/*`).
* Literal paths (no `*`) are returned as-is.
*
* @returns Deduplicated list of expanded paths.
*/
function expandPackageGlobs(patterns, root) {
	const results = [];
	const seen = /* @__PURE__ */ new Set();
	for (const pattern of patterns) {
		if (!pattern.includes("*")) {
			if (!seen.has(pattern)) {
				seen.add(pattern);
				results.push(pattern);
			}
			continue;
		}
		const segments = pattern.split("/");
		const starIndex = segments.findIndex((s) => s.includes("*"));
		if (starIndex === -1) {
			if (!seen.has(pattern)) {
				seen.add(pattern);
				results.push(pattern);
			}
			continue;
		}
		const parentSegments = segments.slice(0, starIndex);
		const parentDir = parentSegments.length > 0 ? resolve(root, parentSegments.join("/")) : root;
		const regexSource = segments[starIndex].replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+");
		const segmentRegex = new RegExp(`^${regexSource}$`);
		const suffixSegments = segments.slice(starIndex + 1);
		let entries;
		try {
			entries = readdirSync(parentDir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!segmentRegex.test(entry)) continue;
			const fullPath = join(parentDir, entry);
			try {
				if (!statSync(fullPath).isDirectory()) continue;
			} catch {
				continue;
			}
			const expanded = [
				...parentSegments,
				entry,
				...suffixSegments
			].join("/");
			if (!seen.has(expanded)) {
				seen.add(expanded);
				results.push(expanded);
			}
		}
	}
	return results;
}
//#endregion
//#region src/graph/topo.ts
/**
* Detect dependency cycles in the package graph.
* Uses DFS with three-color marking (white → gray → black).
*
* @returns Array of cycles, each cycle is an array of package paths forming the loop.
*          Empty array means no cycles.
*/
function detectCycles(packages) {
	const WHITE = 0;
	const GRAY = 1;
	const BLACK = 2;
	const color = /* @__PURE__ */ new Map();
	for (const path of packages.keys()) color.set(path, WHITE);
	const cycles = [];
	const stack = [];
	function dfs(node) {
		color.set(node, GRAY);
		stack.push(node);
		const pkg = packages.get(node);
		if (pkg) for (const dep of pkg.localDependencies) {
			const depColor = color.get(dep);
			if (depColor === void 0) continue;
			if (depColor === GRAY) {
				const cycleStart = stack.indexOf(dep);
				cycles.push([...stack.slice(cycleStart), dep]);
			} else if (depColor === WHITE) dfs(dep);
		}
		stack.pop();
		color.set(node, BLACK);
	}
	for (const path of packages.keys()) if (color.get(path) === WHITE) dfs(path);
	return cycles;
}
/**
* Topological sort of packages using Kahn's algorithm.
* Returns package paths in dependency order (dependencies first).
*
* Only considers edges within the provided package set — external
* dependencies are ignored.
*
* @param subset - If provided, only sort these paths (must be a subset of packages).
*                 Dependencies outside the subset are ignored for ordering.
* @throws Error if a cycle is detected (should not happen if detectCycles ran first).
*/
function topologicalSort(packages, subset) {
	const nodes = subset ?? new Set(packages.keys());
	const inDegree = /* @__PURE__ */ new Map();
	for (const path of nodes) inDegree.set(path, 0);
	for (const path of nodes) {
		const pkg = packages.get(path);
		if (!pkg) continue;
		for (const dep of pkg.localDependencies) {
			if (!nodes.has(dep)) continue;
			inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
		}
	}
	const depCount = /* @__PURE__ */ new Map();
	for (const path of nodes) depCount.set(path, 0);
	for (const path of nodes) {
		const pkg = packages.get(path);
		if (!pkg) continue;
		let count = 0;
		for (const dep of pkg.localDependencies) if (nodes.has(dep)) count++;
		depCount.set(path, count);
	}
	const queue = [];
	for (const [path, count] of depCount) if (count === 0) queue.push(path);
	const sorted = [];
	while (queue.length > 0) {
		const node = queue.shift();
		sorted.push(node);
		for (const path of nodes) {
			const pkg = packages.get(path);
			if (!pkg) continue;
			if (pkg.localDependencies.includes(node)) {
				const remaining = (depCount.get(path) ?? 1) - 1;
				depCount.set(path, remaining);
				if (remaining === 0) queue.push(path);
			}
		}
	}
	if (sorted.length !== nodes.size) {
		const stuck = [...nodes].filter((p) => !sorted.includes(p));
		throw new Error(`Dependency cycle detected among: ${stuck.join(", ")}`);
	}
	return sorted;
}
//#endregion
//#region src/graph/workspace.ts
var workspace_exports = /* @__PURE__ */ __exportAll({ buildWorkspaceGraph: () => buildWorkspaceGraph });
/**
* Build the complete workspace graph from config and manifest parsers.
*
* Steps:
* 1. For each ecosystem, resolve package paths
* 2. Parse each manifest using the ecosystem's parser
* 3. Resolve local dependency paths to workspace-relative paths
* 4. Assemble bridges from config
*/
async function buildWorkspaceGraph(config, root, parsers) {
	const packages = /* @__PURE__ */ new Map();
	const errors = [];
	for (const [ecosystemName, ecosystemConfig] of Object.entries(config.ecosystems)) {
		const parser = parsers.get(ecosystemConfig.manifest);
		if (!parser) {
			errors.push(`No parser registered for manifest "${ecosystemConfig.manifest}" (ecosystem: ${ecosystemName})`);
			continue;
		}
		const expandedPaths = expandPackageGlobs(ecosystemConfig.packages, root);
		for (const pkgPath of expandedPaths) {
			const pkgDir = resolve(root, pkgPath);
			const manifestPath = join(pkgDir, ecosystemConfig.manifest);
			if (!existsSync(manifestPath)) {
				errors.push(`Manifest not found: ${manifestPath} (ecosystem: ${ecosystemName}, package: ${pkgPath})`);
				continue;
			}
			try {
				const parsed = await parser.parse(manifestPath);
				const relativePath = relative(root, pkgDir);
				const localDependencies = parsed.localDependencyPaths.map((absPath) => relative(root, absPath)).filter((relPath) => packages.has(relPath) || isInPackageList(config, relPath));
				const pkg = {
					name: parsed.name,
					path: relativePath,
					ecosystem: ecosystemName,
					version: parsed.version,
					dependencies: parsed.dependencies,
					localDependencies
				};
				packages.set(relativePath, pkg);
			} catch (cause) {
				errors.push(`Failed to parse ${manifestPath}: ${cause instanceof Error ? cause.message : String(cause)}`);
			}
		}
	}
	if (errors.length > 0) throw new Error(`Workspace graph build failed with ${errors.length} error(s):\n` + errors.map((e) => `  - ${e}`).join("\n"));
	const resolvedPackages = /* @__PURE__ */ new Map();
	for (const [path, pkg] of packages) {
		const resolvedLocalDeps = pkg.localDependencies.filter((dep) => packages.has(dep));
		resolvedPackages.set(path, {
			...pkg,
			localDependencies: resolvedLocalDeps
		});
	}
	const cycles = detectCycles(resolvedPackages);
	if (cycles.length > 0) {
		const formatted = cycles.map((cycle) => `  ${cycle.join(" → ")}`).join("\n");
		throw new Error(`Dependency cycle(s) detected in workspace graph:\n${formatted}`);
	}
	const bridges = (config.bridges ?? []).map((b) => {
		const consumers = (b.consumers ?? (b.target ? [b.target] : [])).map((c) => typeof c === "string" ? { path: c } : {
			path: c.path,
			format: c.format
		});
		return {
			source: b.source,
			artifact: b.artifact,
			consumers,
			run: b.run,
			watch: b.watch,
			entryFile: b.entryFile,
			specPath: b.specPath,
			exclude: b.exclude
		};
	});
	return {
		name: config.workspace,
		root,
		packages: resolvedPackages,
		bridges
	};
}
/** Check if a relative path is declared in any ecosystem's package list */
function isInPackageList(config, relPath) {
	for (const eco of Object.values(config.ecosystems)) if (eco.packages.includes(relPath)) return true;
	return false;
}
//#endregion
export { expandPackageGlobs as a, topologicalSort as i, workspace_exports as n, detectCycles as r, buildWorkspaceGraph as t };

//# sourceMappingURL=workspace-MAuyT2B8.js.map