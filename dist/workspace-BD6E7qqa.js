#!/usr/bin/env node
import { t as __exportAll } from "./rolldown-runtime-QdrSlVMC.js";
import { join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
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
		for (const pkgGlob of ecosystemConfig.packages) {
			const pkgDir = resolve(root, pkgGlob);
			const manifestPath = join(pkgDir, ecosystemConfig.manifest);
			if (!existsSync(manifestPath)) {
				errors.push(`Manifest not found: ${manifestPath} (ecosystem: ${ecosystemName}, package: ${pkgGlob})`);
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
	const bridges = (config.bridges ?? []).map((b) => ({
		source: b.source,
		target: b.target,
		artifact: b.artifact,
		run: b.run,
		watch: b.watch,
		entryFile: b.entryFile,
		specPath: b.specPath
	}));
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
export { workspace_exports as n, buildWorkspaceGraph as t };

//# sourceMappingURL=workspace-BD6E7qqa.js.map