#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
//#region src/plugins/builtin/exec.ts
/** Maximum bytes of stdout/stderr to accumulate per process */
const MAX_OUTPUT_BYTES = 1024 * 1024;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Read and parse a package.json file from a package directory.
* @param pkgPath — package path relative to workspace root
* @param root — workspace root absolute path
*/
async function readPackageJson(pkgPath, root) {
	const manifestPath = join(root, pkgPath, "package.json");
	const content = await readFile(manifestPath, "utf-8");
	const parsed = JSON.parse(content);
	if (!isRecord(parsed)) throw new Error(`Expected object in ${manifestPath}`);
	return parsed;
}
/** Extract the scripts record from a parsed package.json */
function getScripts(manifest) {
	const scripts = manifest["scripts"];
	if (!isRecord(scripts)) return {};
	const result = {};
	for (const [key, value] of Object.entries(scripts)) if (typeof value === "string") result[key] = value;
	return result;
}
/** Check if a package.json has a dependency in any dependency group */
function hasDep$1(manifest, name) {
	for (const field of [
		"dependencies",
		"devDependencies",
		"peerDependencies"
	]) {
		const deps = manifest[field];
		if (isRecord(deps) && name in deps) return true;
	}
	return false;
}
/**
* Spawn a command and collect its output.
* Does NOT use shell: true — arguments are passed directly to the executable.
*/
function runCommand(command, args, cwd) {
	const start = performance.now();
	return new Promise((resolve) => {
		const child = spawn(command, [...args], {
			cwd,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		const chunks = [];
		let totalBytes = 0;
		child.stdout.on("data", (data) => {
			if (totalBytes < MAX_OUTPUT_BYTES) {
				chunks.push(data.toString());
				totalBytes += data.length;
			}
		});
		child.stderr.on("data", (data) => {
			if (totalBytes < MAX_OUTPUT_BYTES) {
				chunks.push(data.toString());
				totalBytes += data.length;
			}
		});
		child.on("close", (code) => {
			const duration = Math.round(performance.now() - start);
			const output = chunks.join("");
			if (code === 0) resolve({
				success: true,
				duration,
				summary: `${command} ${args.join(" ")} completed`,
				output
			});
			else resolve({
				success: false,
				duration,
				summary: `${command} ${args.join(" ")} failed (exit ${String(code)})`,
				output
			});
		});
		child.on("error", (err) => {
			resolve({
				success: false,
				duration: Math.round(performance.now() - start),
				summary: `Failed to spawn: ${err.message}`,
				output: err.message
			});
		});
	});
}
//#endregion
//#region src/plugins/builtin/typescript.ts
const WATCH_PATTERNS$1 = ["src/**/*.ts", "src/**/*.tsx"];
const WELL_KNOWN_ACTIONS = [
	"generate",
	"build",
	"dev",
	"codegen"
];
/**
* Parse an openapi-typescript invocation from a package script to extract
* the input artifact path and output path.
*
* Example script: "openapi-typescript ../openapi.prepared.json -o generated/api.d.ts"
* Returns: { input: "../openapi.prepared.json", output: "generated/api.d.ts" }
*/
function parseOpenapiTsScript(scriptValue) {
	const match = /openapi-typescript\s+(\S+).*?\s(?:-o|--output)\s+(\S+)/.exec(scriptValue);
	if (!match) return null;
	const input = match[1];
	const output = match[2];
	if (!input || !output) return null;
	return {
		input,
		output
	};
}
/**
* Detect the openapi-typescript invocation parameters from the package's scripts.
* Searches generate, openapi:generate, and other scripts for openapi-typescript usage.
*/
async function detectOpenapiTsConfig(pkg, root) {
	try {
		const scripts = getScripts(await readPackageJson(pkg.path, root));
		for (const name of [
			"generate",
			"openapi:generate",
			"generate:ts",
			"codegen"
		]) {
			const script = scripts[name];
			if (!script) continue;
			const parsed = parseOpenapiTsScript(script);
			if (parsed) return parsed;
		}
		for (const script of Object.values(scripts)) {
			const parsed = parseOpenapiTsScript(script);
			if (parsed) return parsed;
		}
	} catch {}
	return null;
}
const typescriptPlugin = {
	type: "ecosystem",
	name: "typescript",
	manifest: "package.json",
	async detect(pkg) {
		return pkg.ecosystem === "typescript";
	},
	async getWatchPatterns() {
		return WATCH_PATTERNS$1;
	},
	async getActions(pkg, root) {
		try {
			const scripts = getScripts(await readPackageJson(pkg.path, root));
			const actions = [];
			for (const action of WELL_KNOWN_ACTIONS) if (scripts[action]) actions.push(action);
			for (const key of Object.keys(scripts)) if (!actions.includes(key) && !key.startsWith("pre") && !key.startsWith("post")) actions.push(key);
			return actions;
		} catch {
			return [];
		}
	},
	async execute(action, pkg, root, context) {
		const cwd = join(root, pkg.path);
		const pm = context.packageManager;
		if (action === "generate-openapi-ts") {
			const config = await detectOpenapiTsConfig(pkg, root);
			if (config) return runCommand(pm === "bun" ? "bunx" : "npx", [
				"openapi-typescript",
				config.input,
				"-o",
				config.output
			], cwd);
			return runCommand(pm, ["run", "generate"], cwd);
		}
		return runCommand(pm, ["run", action], cwd);
	},
	async canHandleDomainArtifact(domain, _artifact, pkg, root) {
		if (domain !== "openapi") return null;
		try {
			const manifest = await readPackageJson(pkg.path, root);
			if (hasDep$1(manifest, "openapi-typescript")) return {
				action: "generate-openapi-ts",
				description: "TypeScript types via openapi-typescript"
			};
			if (getScripts(manifest)["generate"]) return {
				action: "generate",
				description: "Generate via package script"
			};
		} catch {}
		return null;
	},
	async suggestWatchPaths(pkg, root) {
		if (existsSync(join(root, pkg.path, "src"))) return {
			paths: [`${pkg.path}/src/**`],
			reason: `Source directory in ${pkg.path}`
		};
		return {
			paths: [`${pkg.path}/**`],
			reason: `Package root of ${pkg.path}`
		};
	}
};
//#endregion
//#region src/plugins/builtin/dart.ts
const WATCH_PATTERNS = ["lib/**/*.dart", "bin/**/*.dart"];
async function readPubspec(pkg, root) {
	const manifestPath = join(root, pkg.path, "pubspec.yaml");
	const parsed = parse(await readFile(manifestPath, "utf-8"));
	if (!isRecord(parsed)) throw new Error(`Expected object in ${manifestPath}`);
	return parsed;
}
function hasDep(manifest, name) {
	for (const field of [
		"dependencies",
		"dev_dependencies",
		"dependency_overrides"
	]) {
		const deps = manifest[field];
		if (isRecord(deps) && name in deps) return true;
	}
	return false;
}
function isFlutterPackage(manifest) {
	const deps = manifest["dependencies"];
	if (!isRecord(deps)) return false;
	return "flutter" in deps;
}
const dartPlugin = {
	type: "ecosystem",
	name: "dart",
	manifest: "pubspec.yaml",
	async detect(pkg) {
		return pkg.ecosystem === "dart";
	},
	async getWatchPatterns() {
		return WATCH_PATTERNS;
	},
	async getActions(pkg, root) {
		try {
			const manifest = await readPubspec(pkg, root);
			const actions = ["pub-get"];
			if (hasDep(manifest, "build_runner")) actions.push("codegen");
			if (hasDep(manifest, "swagger_parser")) actions.push("generate-api");
			return actions;
		} catch {
			return ["pub-get"];
		}
	},
	async execute(action, pkg, root) {
		const cwd = join(root, pkg.path);
		let manifest;
		try {
			manifest = await readPubspec(pkg, root);
		} catch {
			manifest = {};
		}
		const dartCmd = isFlutterPackage(manifest) ? "flutter" : "dart";
		switch (action) {
			case "pub-get": return runCommand(dartCmd, ["pub", "get"], cwd);
			case "codegen": return runCommand("dart", [
				"run",
				"build_runner",
				"build",
				"--delete-conflicting-outputs"
			], cwd);
			case "generate-api": return runCommand("dart", ["run", "swagger_parser"], cwd);
			case "generate-openapi-dart": {
				const swaggerResult = await runCommand("dart", ["run", "swagger_parser"], cwd);
				if (!swaggerResult.success) return swaggerResult;
				return runCommand("dart", [
					"run",
					"build_runner",
					"build",
					"--delete-conflicting-outputs"
				], cwd);
			}
			default: return {
				success: false,
				duration: 0,
				summary: `Unknown action: ${action}`
			};
		}
	},
	async canHandleDomainArtifact(domain, _artifact, pkg, root) {
		if (domain !== "openapi") return null;
		try {
			if (hasDep(await readPubspec(pkg, root), "swagger_parser")) return {
				action: "generate-openapi-dart",
				description: "Dart client via swagger_parser + build_runner"
			};
		} catch {}
		return null;
	},
	async suggestWatchPaths(pkg, root) {
		if (existsSync(join(root, pkg.path, "lib"))) return {
			paths: [`${pkg.path}/lib/**`],
			reason: `Dart source in ${pkg.path}/lib/`
		};
		return {
			paths: [`${pkg.path}/**`],
			reason: `Package root of ${pkg.path}`
		};
	}
};
//#endregion
//#region src/plugins/builtin/openapi.ts
const OPENAPI_FILENAMES = new Set([
	"openapi.json",
	"openapi.yaml",
	"openapi.yml",
	"swagger.json",
	"swagger.yaml"
]);
/** Server framework packages that produce OpenAPI specs */
const SERVER_FRAMEWORKS = new Map([
	["elysia", ["src/routes/**", "src/routes/**/*.ts"]],
	["express", ["src/routes/**", "routes/**"]],
	["fastify", ["src/routes/**", "routes/**"]],
	["hono", ["src/routes/**", "src/**/*.ts"]],
	["koa", ["src/routes/**", "routes/**"]]
]);
/** Patterns in script values that indicate spec preparation */
const PREPARE_SCRIPT_PATTERNS = [
	"spec",
	"openapi",
	"swagger",
	"dart",
	"prepare"
];
/**
* Detect if the source package has a prepare script that post-processes
* the OpenAPI spec. Checks for well-known script names and patterns.
*/
async function detectPrepareScript(source, root) {
	try {
		const scripts = getScripts(await readPackageJson(source.path, root));
		for (const name of [
			"openapi:prepare",
			"spec:prepare",
			"prepare-spec"
		]) if (scripts[name]) return { scriptName: name };
		const prepareScript = scripts["prepare"];
		if (prepareScript) {
			const lower = prepareScript.toLowerCase();
			const matchesPattern = PREPARE_SCRIPT_PATTERNS.some((p) => lower.includes(p));
			const isNpmDefault = lower === "husky" || lower === "mido install" || lower.startsWith("npm ");
			if (matchesPattern && !isNpmDefault) return { scriptName: "prepare" };
		}
	} catch {}
	return null;
}
/**
* Find which package in the workspace has the server framework that
* actually produces the routes. Returns watch path suggestions.
*/
async function findRouteSource(packages, root) {
	for (const [, pkg] of packages) {
		if (pkg.ecosystem !== "typescript") continue;
		try {
			const manifest = await readPackageJson(pkg.path, root);
			for (const [framework, defaultPatterns] of SERVER_FRAMEWORKS) if (hasDep$1(manifest, framework)) return {
				paths: existsSync(join(root, pkg.path, "src", "routes")) ? [`${pkg.path}/src/routes/**`] : defaultPatterns.map((p) => `${pkg.path}/${p}`),
				reason: `Detected ${framework} routes in ${pkg.path}`
			};
		} catch {}
	}
	return null;
}
/**
* Determine which artifact path downstream generators should consume.
* If a prepared spec exists, prefer it over the raw spec.
*/
function resolveArtifactForDownstream(artifact, root) {
	const ext = artifact.includes(".") ? artifact.slice(artifact.lastIndexOf(".")) : "";
	const preparedPath = `${artifact.slice(0, artifact.length - ext.length)}.prepared${ext}`;
	if (existsSync(join(root, preparedPath))) return preparedPath;
	return artifact;
}
const openapiPlugin = {
	type: "domain",
	name: "openapi",
	async detectBridge(artifact) {
		const filename = basename(artifact);
		return OPENAPI_FILENAMES.has(filename);
	},
	async exportArtifact(source, artifact, root, context) {
		const sourceHandler = (await context.findEcosystemHandlers("openapi", artifact)).find((h) => h.pkg.path === source.path);
		if (sourceHandler) return sourceHandler.plugin.execute(sourceHandler.capability.action, source, root, context);
		try {
			const scripts = getScripts(await readPackageJson(source.path, root));
			const exportScriptName = scripts["openapi:export"] ? "openapi:export" : scripts["swagger:export"] ? "swagger:export" : null;
			if (exportScriptName) {
				const cwd = join(root, source.path);
				return runCommand(context.packageManager, ["run", exportScriptName], cwd);
			}
		} catch {}
		return {
			success: false,
			duration: 0,
			summary: `No export method found for ${source.path} — add a "generate" script or install an OpenAPI export plugin`
		};
	},
	async generateDownstream(artifact, targets, root, context) {
		const resolvedArtifact = resolveArtifactForDownstream(artifact, root);
		const handlers = await context.findEcosystemHandlers("openapi", resolvedArtifact);
		const targetPaths = new Set(targets.map((t) => t.path));
		const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));
		if (relevantHandlers.length === 0) return [];
		const results = [];
		for (const handler of relevantHandlers) {
			const result = await handler.plugin.execute(handler.capability.action, handler.pkg, root, context);
			results.push(result);
		}
		return results;
	},
	async buildPipeline(source, artifact, targets, root, context) {
		const steps = [];
		const ext = artifact.includes(".") ? artifact.slice(artifact.lastIndexOf(".")) : "";
		const base = artifact.slice(0, artifact.length - ext.length);
		steps.push({
			name: "export-spec",
			plugin: "openapi",
			description: "exporting spec...",
			outputPaths: [artifact],
			execute: () => openapiPlugin.exportArtifact(source, artifact, root, context)
		});
		const prepareInfo = await detectPrepareScript(source, root);
		if (prepareInfo) {
			const cwd = join(root, source.path);
			const preparedArtifact = `${base}.prepared${ext}`;
			steps.push({
				name: "prepare-spec",
				plugin: "openapi",
				description: "preparing spec...",
				outputPaths: [preparedArtifact, artifact],
				execute: () => runCommand(context.packageManager, ["run", prepareInfo.scriptName], cwd)
			});
		}
		const downstreamArtifact = prepareInfo ? `${base}.prepared${ext}` : artifact;
		const handlers = await context.findEcosystemHandlers("openapi", downstreamArtifact);
		const targetPaths = new Set(targets.map((t) => t.path));
		const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));
		for (const handler of relevantHandlers) steps.push({
			name: `generate-${handler.plugin.name}`,
			plugin: handler.plugin.name,
			description: `${handler.capability.description}...`,
			execute: () => handler.plugin.execute(handler.capability.action, handler.pkg, root, context)
		});
		return steps;
	},
	async suggestWatchPaths(source, _artifact, packages, root) {
		try {
			const manifest = await readPackageJson(source.path, root);
			for (const [framework] of SERVER_FRAMEWORKS) if (hasDep$1(manifest, framework)) return {
				paths: existsSync(join(root, source.path, "src", "routes")) ? [`${source.path}/src/routes/**`] : [`${source.path}/src/**`],
				reason: `Detected ${framework} in ${source.path}`
			};
		} catch {}
		return findRouteSource(packages, root);
	}
};
//#endregion
//#region src/plugins/loader.ts
/**
* Load all plugins — builtins are always present.
*
* External plugins from devDependencies (mido-plugin-*) will be loaded
* on top of builtins when the external plugin system is implemented.
*/
function loadPlugins() {
	return {
		ecosystem: [typescriptPlugin, dartPlugin],
		domain: [openapiPlugin]
	};
}
//#endregion
//#region src/plugins/registry.ts
/**
* Holds loaded plugins and provides context factory for plugin execution.
*/
var PluginRegistry = class {
	ecosystemPlugins;
	domainPlugins;
	constructor(ecosystem, domain) {
		this.ecosystemPlugins = ecosystem;
		this.domainPlugins = domain;
	}
	/** Find the ecosystem plugin for a package based on its ecosystem name */
	getEcosystemForPackage(pkg) {
		return this.ecosystemPlugins.find((p) => p.name === pkg.ecosystem);
	}
	/** Find the domain plugin that can handle a bridge artifact */
	async getDomainForArtifact(artifact, root) {
		for (const plugin of this.domainPlugins) if (await plugin.detectBridge(artifact, root)) return plugin;
	}
	/** Find all ecosystem plugins that can handle a domain artifact across target packages */
	async findEcosystemHandlers(domain, artifact, targets, root) {
		const handlers = [];
		for (const pkg of targets) for (const plugin of this.ecosystemPlugins) {
			if (!plugin.canHandleDomainArtifact) continue;
			const capability = await plugin.canHandleDomainArtifact(domain, artifact, pkg, root);
			if (capability) handlers.push({
				plugin,
				pkg,
				capability
			});
		}
		return handlers;
	}
	/**
	* Ask plugins to suggest watch paths for a bridge.
	* Domain plugins get priority (they understand the artifact type).
	* Falls back to ecosystem plugin suggestions.
	*/
	async suggestWatchPaths(source, artifact, packages, root) {
		const domain = await this.getDomainForArtifact(artifact, root);
		if (domain?.suggestWatchPaths) {
			const suggestion = await domain.suggestWatchPaths(source, artifact, packages, root);
			if (suggestion) return suggestion;
		}
		const ecosystem = this.getEcosystemForPackage(source);
		if (ecosystem?.suggestWatchPaths) return ecosystem.suggestWatchPaths(source, root);
		return null;
	}
	/** Create an ExecutionContext for plugin execution */
	createContext(graph, root, packageManager) {
		return {
			graph,
			root,
			packageManager,
			findEcosystemHandlers: async (domain, artifact) => {
				const allTargets = [...graph.packages.values()];
				return this.findEcosystemHandlers(domain, artifact, allTargets, root);
			}
		};
	}
};
//#endregion
export { loadPlugins as n, PluginRegistry as t };

//# sourceMappingURL=registry-C1i9dp7M.js.map