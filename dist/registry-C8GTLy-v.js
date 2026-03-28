#!/usr/bin/env node
import { r as isRecord, t as MIDO_ROOT } from "./version-M9xRTj7S.js";
import { f as YELLOW, l as RED, u as RESET } from "./output-MbJ98jNX.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { parse } from "yaml";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
//#region src/plugins/types.ts
/** Standard action names shared across ecosystem plugins */
const STANDARD_ACTIONS = {
	LINT: "lint",
	LINT_FIX: "lint:fix",
	FORMAT: "format",
	FORMAT_CHECK: "format:check",
	BUILD: "build",
	TEST: "test",
	TYPECHECK: "typecheck",
	CODEGEN: "codegen"
};
//#endregion
//#region src/plugins/builtin/exec.ts
/** Check if the execution context has pre-resolved file paths */
function hasResolvedFiles(context) {
	return !!context.resolvedFiles && context.resolvedFiles.length > 0;
}
/** Maximum bytes of stdout/stderr to accumulate per process */
const MAX_OUTPUT_BYTES$1 = 1024 * 1024;
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
const DEFAULT_DEP_FIELDS = [
	"dependencies",
	"devDependencies",
	"peerDependencies"
];
/** Check if a manifest has a dependency in the specified dependency groups */
function hasDep(manifest, name, fields = DEFAULT_DEP_FIELDS) {
	for (const field of fields) {
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
			if (totalBytes < MAX_OUTPUT_BYTES$1) {
				chunks.push(data.toString());
				totalBytes += data.length;
			}
		});
		child.stderr.on("data", (data) => {
			if (totalBytes < MAX_OUTPUT_BYTES$1) {
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
//#region src/plugins/builtin/typescript/token-codegen.ts
const HEADER$2 = `/* GENERATED — DO NOT EDIT. Changes will be overwritten. */`;
/** Radius values at or above this threshold are treated as unitless (e.g., pill shapes) */
const FULL_RADIUS_THRESHOLD = 999;
/**
* Convert camelCase to kebab-case.
*/
function camelToKebab(str) {
	return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
/**
* Generate CSS custom properties with light/dark theme support.
*/
function generateCSS(tokens) {
	const { color, spacing, radius, iconSize } = tokens.standard;
	const lines = [HEADER$2, ""];
	const lightVars = [];
	const darkVars = [];
	lightVars.push("  /* ColorScheme — light */");
	darkVars.push("  /* ColorScheme — dark */");
	for (const [key, entry] of Object.entries(color)) {
		const varName = `--color-${camelToKebab(key)}`;
		lightVars.push(`  ${varName}: ${entry.light};`);
		darkVars.push(`  ${varName}: ${entry.dark};`);
	}
	for (const [, ext] of Object.entries(tokens.extensions)) {
		const prefix = ext.meta.getter;
		lightVars.push("");
		lightVars.push(`  /* Extensions — ${ext.meta.className} light */`);
		darkVars.push("");
		darkVars.push(`  /* Extensions — ${ext.meta.className} dark */`);
		for (const [fieldName, field] of Object.entries(ext.fields)) {
			const varName = `--${prefix}-${camelToKebab(fieldName)}`;
			lightVars.push(`  ${varName}: ${field.light};`);
			darkVars.push(`  ${varName}: ${field.dark};`);
		}
	}
	if (Object.keys(spacing).length > 0) {
		lightVars.push("");
		lightVars.push("  /* Spacing */");
		for (const [key, value] of Object.entries(spacing)) lightVars.push(`  --spacing-${camelToKebab(key)}: ${value}px;`);
	}
	if (Object.keys(radius).length > 0) {
		lightVars.push("");
		lightVars.push("  /* Radius */");
		for (const [key, value] of Object.entries(radius)) {
			const unit = value >= FULL_RADIUS_THRESHOLD ? "" : "px";
			lightVars.push(`  --radius-${camelToKebab(key)}: ${value}${unit};`);
		}
	}
	if (Object.keys(iconSize).length > 0) {
		lightVars.push("");
		lightVars.push("  /* Icon size */");
		for (const [key, value] of Object.entries(iconSize)) lightVars.push(`  --icon-${camelToKebab(key)}: ${value}px;`);
	}
	lines.push(":root {");
	lines.push(...lightVars);
	lines.push("}");
	lines.push("");
	lines.push("[data-theme=\"dark\"] {");
	lines.push(...darkVars);
	lines.push("}");
	lines.push("");
	return lines.join("\n");
}
/**
* Generate TypeScript constants for numeric tokens.
*/
function generateTS(tokens) {
	const { spacing, radius, iconSize } = tokens.standard;
	const lines = [HEADER$2, ""];
	if (Object.keys(spacing).length > 0) {
		lines.push("export const DSSpacing = {");
		for (const [key, value] of Object.entries(spacing)) lines.push(`  ${key}: ${value},`);
		lines.push("} as const;");
		lines.push("");
	}
	if (Object.keys(radius).length > 0) {
		lines.push("export const DSRadius = {");
		for (const [key, value] of Object.entries(radius)) lines.push(`  ${key}: ${value},`);
		lines.push("} as const;");
		lines.push("");
	}
	if (Object.keys(iconSize).length > 0) {
		lines.push("export const DSIconSize = {");
		for (const [key, value] of Object.entries(iconSize)) lines.push(`  ${key}: ${value},`);
		lines.push("} as const;");
		lines.push("");
	}
	if (Object.keys(spacing).length > 0) lines.push("export type DSSpacingKey = keyof typeof DSSpacing;");
	if (Object.keys(radius).length > 0) lines.push("export type DSRadiusKey = keyof typeof DSRadius;");
	if (Object.keys(iconSize).length > 0) lines.push("export type DSIconSizeKey = keyof typeof DSIconSize;");
	lines.push("");
	return lines.join("\n");
}
//#endregion
//#region src/plugins/builtin/typescript-codegen.ts
/**
* Narrow unknown domainData to ValidatedTokens.
* ValidatedTokens always has a `color` object at the top level.
*/
function isValidatedTokens$1(value) {
	if (!isRecord(value)) return false;
	if (!isRecord(value["standard"])) return false;
	return typeof value["standard"]["color"] === "object" && value["standard"]["color"] !== null;
}
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
* Detect the openapi-typescript output path from existing scripts.
* Searches generate, openapi:generate, and other scripts for openapi-typescript usage.
* Returns the output path if found in a script.
*/
function detectOutputFromScripts(scripts) {
	for (const name of [
		"generate",
		"openapi:generate",
		"generate:ts",
		"codegen"
	]) {
		const script = scripts[name];
		if (!script) continue;
		const parsed = parseOpenapiTsScript(script);
		if (parsed) return parsed.output;
	}
	for (const script of Object.values(scripts)) {
		const parsed = parseOpenapiTsScript(script);
		if (parsed) return parsed.output;
	}
	return null;
}
/** Well-known output paths for openapi-typescript, checked in order */
const WELL_KNOWN_OUTPUT_PATHS = [
	"generated/api.d.ts",
	"src/generated/api.d.ts",
	"src/api.d.ts"
];
/**
* Resolve the output path for openapi-typescript.
* Priority: existing scripts → existing well-known files → default.
*/
function resolveOutputPath(pkg, root, scripts) {
	const fromScript = detectOutputFromScripts(scripts);
	if (fromScript) return fromScript;
	const pkgDir = join(root, pkg.path);
	for (const candidate of WELL_KNOWN_OUTPUT_PATHS) if (existsSync(join(pkgDir, candidate))) return candidate;
	return "generated/api.d.ts";
}
/**
* Execute design token CSS/TS generation for a TypeScript package.
*
* When context.outputDir is set (new convention), writes to that directory
* (`<source>/generated/typescript/`). Falls back to `<consumer>/generated/`
* for backwards compatibility.
*/
async function executeDesignTokenGeneration$1(pkg, root, context) {
	const start = performance.now();
	const rawDomainData = context.domainData;
	if (!isValidatedTokens$1(rawDomainData)) return {
		success: false,
		duration: 0,
		summary: "No token data provided — design plugin must validate first"
	};
	const tokens = rawDomainData;
	const outDir = context.outputDir ?? join(root, pkg.path, "generated");
	mkdirSync(outDir, { recursive: true });
	if (!existsSync(join(outDir, "package.json"))) {
		const workspace = context.graph.name;
		const source = (context.sourceName ?? "generated").replace(/^@[^/]+\//, "");
		const pkgJson = {
			name: workspace ? `@${workspace}/${source}` : source,
			version: "0.0.0",
			private: true,
			main: "tokens.css",
			types: "tokens.ts"
		};
		writeFileSync(join(outDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
	}
	const cssContent = generateCSS(tokens);
	const tsContent = generateTS(tokens);
	writeFileSync(join(outDir, "tokens.css"), cssContent, "utf-8");
	writeFileSync(join(outDir, "tokens.ts"), tsContent, "utf-8");
	return {
		success: true,
		duration: Math.round(performance.now() - start),
		summary: "2 files written"
	};
}
/**
* Execute OpenAPI TypeScript codegen for a package.
*
* When context.outputDir is set (new convention), generates into that directory.
* Falls back to generating inside the consumer package.
*/
async function executeOpenAPICodegen(pkg, root, context) {
	const pm = context.packageManager;
	let scripts = {};
	try {
		scripts = getScripts(await readPackageJson(pkg.path, root));
	} catch {}
	const artifactPath = context.artifactPath;
	if (!artifactPath) {
		const cwd = join(root, pkg.path);
		if (scripts["generate"]) return runCommand(pm, ["run", "generate"], cwd);
		return {
			success: false,
			duration: 0,
			summary: `No artifact path provided and no generate script found in ${pkg.path}`
		};
	}
	if (context.outputDir) {
		mkdirSync(context.outputDir, { recursive: true });
		if (!existsSync(join(context.outputDir, "package.json"))) {
			const workspace = context.graph.name;
			const rawSource = (context.sourceName ?? "generated").replace(/^@[^/]+\//, "");
			const pkgJson = {
				name: workspace ? `@${workspace}/${rawSource}` : rawSource,
				version: "0.0.0",
				private: true,
				types: "api.d.ts"
			};
			writeFileSync(join(context.outputDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
		}
		const artifactRelative = relative(context.outputDir, join(root, artifactPath));
		return runCommand(pm === "bun" ? "bunx" : "npx", [
			"openapi-typescript",
			artifactRelative,
			"-o",
			"api.d.ts"
		], context.outputDir);
	}
	const cwd = join(root, pkg.path);
	const artifactRelative = relative(cwd, join(root, artifactPath));
	const outputPath = resolveOutputPath(pkg, root, scripts);
	return runCommand(pm === "bun" ? "bunx" : "npx", [
		"openapi-typescript",
		artifactRelative,
		"-o",
		outputPath
	], cwd);
}
//#endregion
//#region src/plugins/builtin/typescript/lint-config.ts
const CACHE_DIR_NAME = "node_modules/.cache/mido";
/** Ensure the cache directory exists and return its absolute path */
function ensureCacheDir(root) {
	const cacheDir = join(root, CACHE_DIR_NAME);
	mkdirSync(cacheDir, { recursive: true });
	return cacheDir;
}
/** Cache for written config paths — avoids concurrent writes to the same file */
let cachedOxlintConfigPath;
let cachedOxfmtConfigPath;
/** Oxlint plugins always enabled */
const ALWAYS_ENABLED_PLUGINS = [
	"typescript",
	"unicorn",
	"oxc",
	"import"
];
/** Dependency-to-plugin mapping for auto-detection */
const DEP_PLUGIN_MAP = new Map([
	["react", [
		"react",
		"jsx-a11y",
		"react-perf"
	]],
	["preact", [
		"react",
		"jsx-a11y",
		"react-perf"
	]],
	["@preact/preset-vite", [
		"react",
		"jsx-a11y",
		"react-perf"
	]],
	["jest", ["jest"]],
	["vitest", ["vitest"]],
	["next", ["nextjs"]]
]);
/**
* Auto-detect oxlint plugins based on workspace dependencies.
* Always enables: typescript, unicorn, oxc, import.
* Conditionally enables: react, jsx-a11y, react-perf (if React/Preact), jest, vitest, nextjs.
*/
function detectOxlintPlugins(pkg, root) {
	const plugins = new Set(ALWAYS_ENABLED_PLUGINS);
	try {
		const manifestPath = join(root, pkg.path, "package.json");
		if (!existsSync(manifestPath)) return [...plugins];
		const raw = readFileSync(manifestPath, "utf-8");
		const manifest = JSON.parse(raw);
		if (!isRecord(manifest)) return [...plugins];
		for (const [dep, depPlugins] of DEP_PLUGIN_MAP) if (hasDep(manifest, dep)) for (const p of depPlugins) plugins.add(p);
	} catch {}
	return [...plugins];
}
const ALL_CATEGORIES = [
	"correctness",
	"suspicious",
	"pedantic",
	"perf",
	"style",
	"restriction",
	"nursery"
];
/**
* Generate a temporary oxlintrc.json from the mido lint.typescript config.
* Includes categories, rules, and auto-detected plugins.
* Returns the path to the file, or null if no config is needed.
*/
function writeOxlintConfig(root, lint, plugins) {
	const config = {};
	if (lint.categories) {
		const categories = {};
		for (const cat of ALL_CATEGORIES) {
			const level = lint.categories[cat];
			if (level !== void 0) categories[cat] = level;
		}
		if (Object.keys(categories).length > 0) config["categories"] = categories;
	}
	if (lint.rules && Object.keys(lint.rules).length > 0) config["rules"] = lint.rules;
	if (plugins.length > 0) config["plugins"] = plugins;
	if (cachedOxlintConfigPath !== void 0) return cachedOxlintConfigPath;
	const configPath = join(ensureCacheDir(root), "oxlintrc.json");
	writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
	cachedOxlintConfigPath = configPath;
	return configPath;
}
/**
* Generate a temporary oxfmtrc.json from the mido format.typescript config.
* Returns the config path, or null if no config is needed.
*/
function writeOxfmtConfig(root, format) {
	if (cachedOxfmtConfigPath !== void 0) return cachedOxfmtConfigPath;
	const opts = {};
	for (const [key, value] of Object.entries(format)) if (value !== void 0) opts[key] = value;
	if (Object.keys(opts).length === 0) {
		cachedOxfmtConfigPath = null;
		return null;
	}
	const configPath = join(ensureCacheDir(root), "oxfmtrc.json");
	writeFileSync(configPath, JSON.stringify(opts, null, 2) + "\n", "utf-8");
	cachedOxfmtConfigPath = configPath;
	return configPath;
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
/** Action name for direct openapi-typescript invocation */
const ACTION_GENERATE_OPENAPI_TS = "generate-openapi-ts";
/** Action name for design token CSS/TS generation */
const ACTION_GENERATE_DESIGN_TOKENS_CSS = "generate-design-tokens-css";
/**
* Resolve a binary for a TS tool (linter, formatter).
*
* Resolution order:
*  1. Workspace root node_modules — user override takes precedence
*  2. Mido's own node_modules   — bundled oxlint / oxfmt
*  3. Fall through (null)        — caller can try bare name on PATH
*/
function resolveBin(name, workspaceRoot) {
	const workspaceBin = join(workspaceRoot, "node_modules", ".bin", name);
	if (existsSync(workspaceBin)) return workspaceBin;
	const bundledBin = join(MIDO_ROOT, "node_modules", ".bin", name);
	if (existsSync(bundledBin)) return bundledBin;
	return null;
}
/**
* Find the source directory for a TS package.
* Prefers src/, falls back to lib/, then package root.
* When falling back to root, returns it so the caller can decide
* whether to add glob filters for tools that scan recursively.
*/
function findSourceDir(pkg, root) {
	const pkgDir = join(root, pkg.path);
	if (existsSync(join(pkgDir, "src"))) return {
		dir: join(pkgDir, "src"),
		isRoot: false
	};
	if (existsSync(join(pkgDir, "lib"))) return {
		dir: join(pkgDir, "lib"),
		isRoot: false
	};
	return {
		dir: pkgDir,
		isRoot: true
	};
}
function executeFormat(pkg, root, cwd, context, check) {
	const oxfmt = resolveBin("oxfmt", root);
	if (oxfmt) {
		const args = check ? ["--check"] : [];
		const fmtTs = context.formatTypescript;
		if (fmtTs) {
			const configPath = writeOxfmtConfig(root, fmtTs);
			if (configPath) args.push("--config", configPath);
		}
		if (hasResolvedFiles(context)) args.push(...context.resolvedFiles);
		else {
			const { dir, isRoot } = findSourceDir(pkg, root);
			if (isRoot) args.push("--no-error-on-unmatched-pattern", join(dir, "**/*.ts"), join(dir, "**/*.tsx"));
			else args.push(dir);
		}
		return runCommand(oxfmt, args, cwd);
	}
	const prettier = resolveBin("prettier", root);
	if (prettier) {
		const flag = check ? "--check" : "--write";
		if (hasResolvedFiles(context)) return runCommand(prettier, [flag, ...context.resolvedFiles], cwd);
		const { dir } = findSourceDir(pkg, root);
		return runCommand(prettier, [flag, dir], cwd);
	}
	return {
		success: true,
		duration: 0,
		summary: `No formatter found for ${pkg.path}. Install oxfmt or prettier.`
	};
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
			const manifest = await readPackageJson(pkg.path, root);
			const scripts = getScripts(manifest);
			const actions = [];
			actions.push(STANDARD_ACTIONS.LINT);
			actions.push(STANDARD_ACTIONS.FORMAT);
			actions.push(STANDARD_ACTIONS.FORMAT_CHECK);
			if (scripts["build"]) actions.push(STANDARD_ACTIONS.BUILD);
			if (scripts["test"]) actions.push(STANDARD_ACTIONS.TEST);
			if (hasDep(manifest, "typescript") || existsSync(join(root, pkg.path, "tsconfig.json"))) actions.push(STANDARD_ACTIONS.TYPECHECK);
			for (const action of WELL_KNOWN_ACTIONS) if (scripts[action] && !actions.includes(action)) actions.push(action);
			for (const key of Object.keys(scripts)) if (!actions.includes(key) && !key.startsWith("pre") && !key.startsWith("post")) actions.push(key);
			return actions;
		} catch {
			return [];
		}
	},
	async execute(action, pkg, root, context) {
		const cwd = join(root, pkg.path);
		const pm = context.packageManager;
		if (action === STANDARD_ACTIONS.LINT || action === STANDARD_ACTIONS.LINT_FIX) {
			const fix = action === STANDARD_ACTIONS.LINT_FIX;
			const oxlint = resolveBin("oxlint", root);
			if (oxlint) {
				const args = [];
				const plugins = detectOxlintPlugins(pkg, root);
				const lintTs = context.lintTypescript;
				const configPath = writeOxlintConfig(root, lintTs ?? {}, plugins);
				if (configPath) args.push("--config", configPath);
				if (fix) args.push("--fix");
				if (hasResolvedFiles(context)) args.push(...context.resolvedFiles);
				else {
					const { dir } = findSourceDir(pkg, root);
					args.push(dir);
				}
				return runCommand(oxlint, args, cwd);
			}
			const eslint = resolveBin("eslint", root);
			if (eslint) {
				if (hasResolvedFiles(context)) return runCommand(eslint, fix ? ["--fix", ...context.resolvedFiles] : [...context.resolvedFiles], cwd);
				const { dir } = findSourceDir(pkg, root);
				return runCommand(eslint, fix ? ["--fix", dir] : [dir], cwd);
			}
			return {
				success: true,
				duration: 0,
				summary: `No linter found for ${pkg.path}. Install oxlint or eslint.`
			};
		}
		if (action === STANDARD_ACTIONS.FORMAT || action === STANDARD_ACTIONS.FORMAT_CHECK) return executeFormat(pkg, root, cwd, context, action === STANDARD_ACTIONS.FORMAT_CHECK);
		if (action === STANDARD_ACTIONS.BUILD) return runCommand(pm, ["run", "build"], cwd);
		if (action === STANDARD_ACTIONS.TEST) return runCommand(pm, ["run", "test"], cwd);
		if (action === STANDARD_ACTIONS.TYPECHECK) {
			let scripts = {};
			try {
				scripts = getScripts(await readPackageJson(pkg.path, root));
			} catch {}
			if (scripts["typecheck"]) return runCommand(pm, ["run", "typecheck"], cwd);
			return runCommand(pm === "bun" ? "bunx" : "npx", ["tsc", "--noEmit"], cwd);
		}
		if (action === ACTION_GENERATE_DESIGN_TOKENS_CSS) return executeDesignTokenGeneration$1(pkg, root, context);
		if (action === ACTION_GENERATE_OPENAPI_TS) return executeOpenAPICodegen(pkg, root, context);
		return runCommand(pm, ["run", action], cwd);
	},
	async canHandleDomainArtifact(domain, _artifact, pkg, _root) {
		if (pkg.ecosystem !== "typescript") return null;
		if (domain === "design-tokens") return {
			action: ACTION_GENERATE_DESIGN_TOKENS_CSS,
			description: "CSS custom properties + TS constants"
		};
		if (domain === "openapi") return {
			action: ACTION_GENERATE_OPENAPI_TS,
			description: "TypeScript types via openapi-typescript"
		};
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
//#region src/plugins/builtin/dart/token-theme.ts
const HEADER$1 = `// GENERATED — DO NOT EDIT. Changes will be overwritten.`;
/**
* Convert a color value string to a Dart Color constructor.
* Supports #RGB, #RRGGBB, #RRGGBBAA hex, rgb(a)(), and hsl(a)() colors.
*/
function colorToDart$1(value) {
	if (value.startsWith("#")) {
		const expanded = expandShortHex$1(value.slice(1).toUpperCase());
		if (expanded.length === 8) {
			const rgb = expanded.slice(0, 6);
			return `Color(0x${expanded.slice(6, 8)}${rgb})`;
		}
		return `Color(0xFF${expanded})`;
	}
	const rgbaMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(value);
	if (rgbaMatch) return `Color.fromRGBO(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${rgbaMatch[4] ?? "1.0"})`;
	const hslMatch = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*(?:,\s*([\d.]+))?\s*\)$/.exec(value);
	if (hslMatch) {
		const h = hslMatch[1];
		const s = hslMatch[2];
		const l = hslMatch[3];
		return `HSLColor.fromAHSL(${hslMatch[4] ?? "1.0"}, ${h}, ${Number(s) / 100}, ${Number(l) / 100}).toColor()`;
	}
	return `Color(0xFF000000) /* unrecognized: ${value} */`;
}
/**
* Expand 3-char hex (#RGB) → 6-char (#RRGGBB).
* Returns the input unchanged if not a 3-char hex.
*/
function expandShortHex$1(hex) {
	if (hex.length === 3) return `${hex.charAt(0)}${hex.charAt(0)}${hex.charAt(1)}${hex.charAt(1)}${hex.charAt(2)}${hex.charAt(2)}`;
	return hex;
}
/**
* Generate ThemeExtension classes — one per custom extension section.
* All extension fields are themed colors (light/dark pairs).
*/
function generateThemeExtensions(tokens) {
	const extEntries = Object.entries(tokens.extensions);
	if (extEntries.length === 0) return `${HEADER$1}\n\n// No extensions defined in tokens.json\n`;
	const lines = [
		HEADER$1,
		"",
		"import 'dart:ui';",
		"",
		"import 'package:flutter/material.dart';",
		""
	];
	let index = 0;
	for (const [, ext] of extEntries) {
		const { className } = ext.meta;
		const fieldNames = Object.keys(ext.fields);
		lines.push("@immutable");
		lines.push(`class ${className} extends ThemeExtension<${className}> {`);
		lines.push(`  const ${className}({`);
		for (const name of fieldNames) lines.push(`    required this.${name},`);
		lines.push("  });");
		lines.push("");
		for (const name of fieldNames) lines.push(`  final Color ${name};`);
		lines.push("");
		lines.push(`  static const light = ${className}(`);
		for (const name of fieldNames) {
			const field = ext.fields[name];
			if (!field) continue;
			lines.push(`    ${name}: ${colorToDart$1(field.light)},`);
		}
		lines.push("  );");
		lines.push("");
		lines.push(`  static const dark = ${className}(`);
		for (const name of fieldNames) {
			const field = ext.fields[name];
			if (!field) continue;
			lines.push(`    ${name}: ${colorToDart$1(field.dark)},`);
		}
		lines.push("  );");
		lines.push("");
		lines.push("  @override");
		lines.push(`  ${className} copyWith({`);
		for (const name of fieldNames) lines.push(`    Color? ${name},`);
		lines.push("  }) {");
		lines.push(`    return ${className}(`);
		for (const name of fieldNames) lines.push(`      ${name}: ${name} ?? this.${name},`);
		lines.push("    );");
		lines.push("  }");
		lines.push("");
		lines.push("  @override");
		lines.push(`  ${className} lerp(${className}? other, double t) {`);
		lines.push(`    if (other is! ${className}) return this;`);
		lines.push(`    return ${className}(`);
		for (const name of fieldNames) lines.push(`      ${name}: Color.lerp(${name}, other.${name}, t)!,`);
		lines.push("    );");
		lines.push("  }");
		lines.push("}");
		index++;
		if (index < extEntries.length) lines.push("");
	}
	lines.push("");
	return lines.join("\n");
}
/**
* Generate the ThemeData assembly file.
*/
function generateTheme(tokens, packageName) {
	const extEntries = Object.entries(tokens.extensions);
	const typo = tokens.standard.typography;
	const provider = typo?.provider ?? "asset";
	const lines = [HEADER$1, ""];
	lines.push("import 'package:flutter/material.dart';");
	if (provider === "google_fonts") lines.push("import 'package:google_fonts/google_fonts.dart';");
	lines.push(`import 'package:${packageName}/core/theme/generated/generated.dart';`);
	lines.push("");
	lines.push(`export 'package:${packageName}/core/theme/generated/generated.dart';`);
	lines.push("");
	lines.push("extension ThemeContextExtension on BuildContext {");
	lines.push("  ColorScheme get colorScheme => Theme.of(this).colorScheme;");
	lines.push("  TextTheme get textTheme => Theme.of(this).textTheme;");
	for (const [, ext] of extEntries) {
		const { className, getter } = ext.meta;
		lines.push(`  ${className} get ${getter} => Theme.of(this).extension<${className}>()!;`);
	}
	if (typo?.scale) {
		lines.push("");
		for (const key of Object.keys(typo.scale)) lines.push(`  TextStyle get ${key} => textTheme.${key}!;`);
	}
	lines.push("}");
	lines.push("");
	lines.push("extension ColorToHex on Color {");
	lines.push("  String get hex {");
	lines.push("    final r = (this.r * 255).round().toRadixString(16).padLeft(2, '0');");
	lines.push("    final g = (this.g * 255).round().toRadixString(16).padLeft(2, '0');");
	lines.push("    final b = (this.b * 255).round().toRadixString(16).padLeft(2, '0');");
	lines.push("    return '#$r$g$b';");
	lines.push("  }");
	lines.push("}");
	lines.push("");
	lines.push("abstract final class AppTheme {");
	const extArgs = extEntries.map(([, ext]) => `    ${ext.meta.className}.light,`).join("\n");
	const extArgsDark = extEntries.map(([, ext]) => `    ${ext.meta.className}.dark,`).join("\n");
	lines.push("  static final ThemeData light = _build(");
	lines.push("    GeneratedColorScheme.light,");
	if (extArgs) lines.push(extArgs);
	lines.push("  );");
	lines.push("");
	lines.push("  static final ThemeData dark = _build(");
	lines.push("    GeneratedColorScheme.dark,");
	if (extArgsDark) lines.push(extArgsDark);
	lines.push("  );");
	lines.push("");
	const extParams = extEntries.map(([, ext]) => `    ${ext.meta.className} ${ext.meta.getter},`).join("\n");
	lines.push("  static ThemeData _build(");
	lines.push("    ColorScheme scheme,");
	if (extParams) lines.push(extParams);
	lines.push("  ) {");
	lines.push("    return ThemeData(");
	lines.push("      useMaterial3: true,");
	lines.push("      brightness: scheme.brightness,");
	lines.push("      colorScheme: scheme,");
	lines.push("      scaffoldBackgroundColor: scheme.surface,");
	if (extEntries.length > 0) {
		const extList = extEntries.map(([, ext]) => ext.meta.getter).join(", ");
		lines.push(`      extensions: [${extList}],`);
	}
	if (typo?.fontFamily) {
		const firstFamily = Object.values(typo.fontFamily)[0];
		if (firstFamily) lines.push(`      fontFamily: '${firstFamily}',`);
	}
	lines.push("      textTheme: _buildTextTheme(scheme),");
	lines.push("    );");
	lines.push("  }");
	lines.push("");
	lines.push("  static TextTheme _buildTextTheme(ColorScheme scheme) {");
	lines.push("    return TextTheme(");
	if (typo?.scale) for (const [key, entry] of Object.entries(typo.scale)) {
		const familyName = typo.fontFamily[entry.family] ?? entry.family;
		const dartWeight = `FontWeight.w${typo.fontWeight[entry.weight] ?? 400}`;
		let expr;
		if (provider === "google_fonts") expr = `GoogleFonts.${familyName.split(" ").map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)).join("")}(\n        fontSize: ${entry.size},\n        fontWeight: ${dartWeight},\n        color: scheme.onSurface,\n      )`;
		else if (provider === "asset") expr = `TextStyle(\n        fontFamily: '${familyName}',\n        fontSize: ${entry.size},\n        fontWeight: ${dartWeight},\n        color: scheme.onSurface,\n      )`;
		else expr = `TextStyle(\n        fontSize: ${entry.size},\n        fontWeight: ${dartWeight},\n        color: scheme.onSurface,\n      )`;
		lines.push(`      ${key}: ${expr},`);
	}
	lines.push("    );");
	lines.push("  }");
	lines.push("}");
	lines.push("");
	return lines.join("\n");
}
//#endregion
//#region src/plugins/builtin/dart/token-codegen.ts
const HEADER = `// GENERATED — DO NOT EDIT. Changes will be overwritten.`;
/**
* Expand 3-char hex (#RGB) → 6-char (#RRGGBB).
* Returns the input unchanged if not a 3-char hex.
*/
function expandShortHex(hex) {
	if (hex.length === 3) return `${hex.charAt(0)}${hex.charAt(0)}${hex.charAt(1)}${hex.charAt(1)}${hex.charAt(2)}${hex.charAt(2)}`;
	return hex;
}
/**
* Convert a color value string to a Dart Color constructor.
* Supports #RGB, #RRGGBB, #RRGGBBAA hex, rgb(a)(), and hsl(a)() colors.
*/
function colorToDart(value) {
	if (value.startsWith("#")) {
		const expanded = expandShortHex(value.slice(1).toUpperCase());
		if (expanded.length === 8) {
			const rgb = expanded.slice(0, 6);
			return `Color(0x${expanded.slice(6, 8)}${rgb})`;
		}
		return `Color(0xFF${expanded})`;
	}
	const rgbaMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(value);
	if (rgbaMatch) return `Color.fromRGBO(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${rgbaMatch[4] ?? "1.0"})`;
	const hslMatch = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*(?:,\s*([\d.]+))?\s*\)$/.exec(value);
	if (hslMatch) {
		const h = hslMatch[1];
		const s = hslMatch[2];
		const l = hslMatch[3];
		return `HSLColor.fromAHSL(${hslMatch[4] ?? "1.0"}, ${h}, ${Number(s) / 100}, ${Number(l) / 100}).toColor()`;
	}
	return `Color(0xFF000000) /* unrecognized: ${value} */`;
}
/**
* Encode a color with a separate opacity into a Dart Color.
* For hex colors, bakes the alpha into 0xAARRGGBB directly.
* For other formats, applies .withValues(alpha:) on the converted color.
*/
function shadowToDartColor(color, opacity) {
	if (color.startsWith("#")) {
		const clean = expandShortHex(color.slice(1).toUpperCase()).slice(0, 6);
		return `Color(0x${Math.round(opacity * 255).toString(16).padStart(2, "0").toUpperCase()}${clean})`;
	}
	return `${colorToDart(color)}.withValues(alpha: ${opacity})`;
}
const COLOR_SCHEME_FIELDS = [
	"primary",
	"onPrimary",
	"primaryContainer",
	"onPrimaryContainer",
	"primaryFixed",
	"primaryFixedDim",
	"onPrimaryFixed",
	"onPrimaryFixedVariant",
	"secondary",
	"onSecondary",
	"secondaryContainer",
	"onSecondaryContainer",
	"secondaryFixed",
	"secondaryFixedDim",
	"onSecondaryFixed",
	"onSecondaryFixedVariant",
	"tertiary",
	"onTertiary",
	"tertiaryContainer",
	"onTertiaryContainer",
	"tertiaryFixed",
	"tertiaryFixedDim",
	"onTertiaryFixed",
	"onTertiaryFixedVariant",
	"surface",
	"onSurface",
	"onSurfaceVariant",
	"surfaceDim",
	"surfaceBright",
	"surfaceTint",
	"surfaceContainerLowest",
	"surfaceContainerLow",
	"surfaceContainer",
	"surfaceContainerHigh",
	"surfaceContainerHighest",
	"error",
	"onError",
	"errorContainer",
	"onErrorContainer",
	"outline",
	"outlineVariant",
	"inverseSurface",
	"onInverseSurface",
	"inversePrimary",
	"shadow",
	"scrim"
];
/**
* Generate the M3 ColorScheme Dart file.
*/
function generateColorScheme(tokens) {
	const { color } = tokens.standard;
	const lines = [
		HEADER,
		"",
		"import 'package:flutter/material.dart';",
		""
	];
	lines.push("abstract final class GeneratedColorScheme {");
	for (const mode of ["light", "dark"]) {
		lines.push(`  static ColorScheme get ${mode} => const ColorScheme.${mode}(`);
		for (const field of COLOR_SCHEME_FIELDS) {
			const entry = color[field];
			if (!entry) continue;
			lines.push(`    ${field}: ${colorToDart(entry[mode])},`);
		}
		lines.push("  );");
		if (mode === "light") lines.push("");
	}
	lines.push("}");
	lines.push("");
	return lines.join("\n");
}
/**
* Generate constants: DSSpacing, DSRadius, DSElevation, DSIconSize, DSShadow.
*/
function generateConstants(tokens) {
	const { spacing, radius, elevation, shadowCard, iconSize } = tokens.standard;
	const lines = [
		HEADER,
		"",
		"import 'package:flutter/material.dart';",
		""
	];
	if (Object.keys(spacing).length > 0) {
		lines.push("abstract final class DSSpacing {");
		for (const [key, value] of Object.entries(spacing)) lines.push(`  static const double ${key} = ${value};`);
		lines.push("}");
		lines.push("");
	}
	if (Object.keys(radius).length > 0) {
		lines.push("abstract final class DSRadius {");
		for (const [key, value] of Object.entries(radius)) lines.push(`  static const double ${key} = ${value};`);
		lines.push("");
		lines.push("  // Convenience BorderRadius constructors");
		for (const [key, value] of Object.entries(radius)) {
			if (value <= 0) continue;
			lines.push(`  static const BorderRadius ${key}All = BorderRadius.all(Radius.circular(${key}));`);
		}
		lines.push("}");
		lines.push("");
	}
	if (Object.keys(elevation).length > 0) {
		lines.push("abstract final class DSElevation {");
		for (const [key, entry] of Object.entries(elevation)) lines.push(`  static const double ${key} = ${entry.dp};`);
		lines.push("}");
		lines.push("");
	}
	if (Object.keys(iconSize).length > 0) {
		lines.push("abstract final class DSIconSize {");
		for (const [key, value] of Object.entries(iconSize)) lines.push(`  static const double ${key} = ${value};`);
		lines.push("}");
		lines.push("");
	}
	if (Object.keys(elevation).length > 0) for (const mode of ["light", "dark"]) {
		const clsName = mode === "light" ? "DSShadow" : "DSShadowDark";
		lines.push(`abstract final class ${clsName} {`);
		if (shadowCard) {
			const shadows = shadowCard[mode];
			lines.push("  static const List<BoxShadow> card = [");
			for (const s of shadows) {
				lines.push("    BoxShadow(");
				lines.push(`      offset: Offset(${s.x}, ${s.y}),`);
				lines.push(`      blurRadius: ${s.blur},`);
				lines.push(`      spreadRadius: ${s.spread},`);
				lines.push(`      color: ${shadowToDartColor(s.color, s.opacity)},`);
				lines.push("    ),");
			}
			lines.push("  ];");
			lines.push("");
		}
		for (const [key, entry] of Object.entries(elevation)) {
			const shadows = entry.shadow[mode];
			lines.push(`  static const List<BoxShadow> ${key} = [`);
			for (const s of shadows) {
				lines.push("    BoxShadow(");
				lines.push(`      offset: Offset(${s.x}, ${s.y}),`);
				lines.push(`      blurRadius: ${s.blur},`);
				lines.push(`      spreadRadius: ${s.spread},`);
				lines.push(`      color: ${shadowToDartColor(s.color, s.opacity)},`);
				lines.push("    ),");
			}
			lines.push("  ];");
		}
		lines.push("}");
		lines.push("");
	}
	return lines.join("\n");
}
/**
* Generate a barrel file that re-exports all generated files.
*/
function generateBarrel(fileNames) {
	const lines = [HEADER, ""];
	for (const name of fileNames) lines.push(`export '${name}';`);
	lines.push("");
	return lines.join("\n");
}
/**
* Generate the top-level package barrel file.
*/
function generatePackageBarrel(_packageName) {
	const lines = [HEADER, ""];
	lines.push("export 'core/theme/theme.dart';");
	lines.push("");
	return lines.join("\n");
}
//#endregion
//#region src/plugins/builtin/dart/openapi-codegen.ts
/**
* Execute OpenAPI Dart client generation into outputDir.
*
* Scaffolds a dart package at outputDir with swagger_parser + build_runner,
* creates a swagger_parser config pointing to the artifact, then runs both tools.
*/
async function executeOpenAPIDartGeneration(_pkg, root, context) {
	const start = performance.now();
	const outDir = context.outputDir;
	if (!outDir) return {
		success: false,
		duration: 0,
		summary: "No outputDir provided"
	};
	mkdirSync(outDir, { recursive: true });
	const workspace = context.graph.name.replace(/-/g, "_").replace(/@/g, "").replace(/\//g, "_");
	const source = (context.sourceName ?? "generated").replace(/^@[^/]+\//, "").replace(/-/g, "_").replace(/@/g, "").replace(/\//g, "_");
	const packageName = workspace ? `${workspace}_${source}` : source;
	if (!existsSync(join(outDir, "pubspec.yaml"))) {
		const libDir = join(outDir, "lib");
		mkdirSync(libDir, { recursive: true });
		const pubspec = [
			`name: ${packageName}`,
			"publish_to: none",
			"",
			"environment:",
			"  sdk: '>=3.0.0 <4.0.0'",
			"",
			"dependencies:",
			"  dio: ^5.9.0",
			"  retrofit: '^4.9.0'",
			"  freezed_annotation: ^3.1.0",
			"  json_annotation: '^4.11.0'",
			"",
			"dev_dependencies:",
			"  build_runner: '^2.4.0'",
			"  freezed: ^3.2.0",
			"  json_serializable: '^6.13.0'",
			"  retrofit_generator: '>=10.2.0'",
			"  swagger_parser: ^1.43.0",
			""
		];
		writeFileSync(join(outDir, "pubspec.yaml"), pubspec.join("\n"), "utf-8");
		writeFileSync(join(libDir, `${packageName}.dart`), `library ${packageName};\n`, "utf-8");
	}
	const artifactPath = context.artifactPath;
	if (!artifactPath) return {
		success: false,
		duration: 0,
		summary: "No artifact path provided for OpenAPI generation"
	};
	const swaggerConfig = [
		"swagger_parser:",
		`  schema_path: ${join(root, artifactPath)}`,
		"  output_directory: lib/",
		"  language: dart",
		"  freezed: true",
		""
	];
	writeFileSync(join(outDir, "swagger_parser.yaml"), swaggerConfig.join("\n"), "utf-8");
	const pubGetResult = await runCommand("dart", ["pub", "get"], outDir);
	if (!pubGetResult.success) return {
		success: false,
		duration: Math.round(performance.now() - start),
		summary: `dart pub get failed in ${outDir}`,
		output: pubGetResult.output
	};
	const swaggerResult = await runCommand("dart", ["run", "swagger_parser"], outDir);
	if (!swaggerResult.success) return {
		success: false,
		duration: Math.round(performance.now() - start),
		summary: "swagger_parser failed",
		output: swaggerResult.output
	};
	const buildResult = await runCommand("dart", [
		"run",
		"build_runner",
		"build",
		"--delete-conflicting-outputs"
	], outDir);
	const duration = Math.round(performance.now() - start);
	if (!buildResult.success) return {
		success: false,
		duration,
		summary: "build_runner failed",
		output: buildResult.output
	};
	return {
		success: true,
		duration,
		summary: "Dart OpenAPI client generated"
	};
}
//#endregion
//#region src/plugins/builtin/dart.ts
/** Dart-specific dependency fields */
const DART_DEP_FIELDS = [
	"dependencies",
	"dev_dependencies",
	"dependency_overrides"
];
/**
* Narrow unknown domainData to ValidatedTokens.
* ValidatedTokens always has a `color` object at the top level.
*/
function isValidatedTokens(value) {
	if (!isRecord(value)) return false;
	if (!isRecord(value["standard"])) return false;
	return typeof value["standard"]["color"] === "object" && value["standard"]["color"] !== null;
}
const WATCH_PATTERNS = ["lib/**/*.dart", "bin/**/*.dart"];
/** Action names for Dart-specific operations */
const ACTION_PUB_GET = "pub-get";
const ACTION_CODEGEN = "codegen";
const ACTION_GENERATE_API = "generate-api";
const ACTION_GENERATE_OPENAPI_DART = "generate-openapi-dart";
const ACTION_GENERATE_DESIGN_TOKENS = "generate-design-tokens";
async function readPubspec(pkg, root) {
	const manifestPath = join(root, pkg.path, "pubspec.yaml");
	const parsed = parse(await readFile(manifestPath, "utf-8"));
	if (!isRecord(parsed)) throw new Error(`Expected object in ${manifestPath}`);
	return parsed;
}
function isFlutterPackage(manifest) {
	const deps = manifest["dependencies"];
	if (!isRecord(deps)) return false;
	return "flutter" in deps;
}
/**
* Scaffold a Flutter package at the given path if it doesn't exist.
* Creates pubspec.yaml, lib/ structure, and package barrel.
*/
function scaffoldDartPackage(pkgDir, packageName, tokens) {
	mkdirSync(join(join(join(pkgDir, "lib"), "core", "theme"), "generated"), { recursive: true });
	const needsGoogleFonts = tokens.standard.typography?.provider === "google_fonts";
	const pubspec = [
		`name: ${packageName}`,
		"publish_to: none",
		"",
		"environment:",
		"  sdk: '>=3.0.0 <4.0.0'",
		"  flutter: '>=3.10.0'",
		"",
		"dependencies:",
		"  flutter:",
		"    sdk: flutter"
	];
	if (needsGoogleFonts) pubspec.push("  google_fonts: ^6.0.0");
	pubspec.push("");
	writeFileSync(join(pkgDir, "pubspec.yaml"), pubspec.join("\n"), "utf-8");
}
/**
* Execute design token generation for a Dart/Flutter target.
*
* When context.outputDir is set (new convention), writes to that directory
* (`<source>/generated/dart/`). Falls back to `<consumer>/` for backwards
* compatibility.
*/
async function executeDesignTokenGeneration(pkg, root, context) {
	const start = performance.now();
	const rawDomainData = context.domainData;
	if (!isValidatedTokens(rawDomainData)) return {
		success: false,
		duration: 0,
		summary: "No token data provided — design plugin must validate first"
	};
	const tokens = rawDomainData;
	const outRoot = context.outputDir ?? join(root, pkg.path);
	const workspace = context.graph.name.replace(/-/g, "_").replace(/@/g, "").replace(/\//g, "_");
	const source = (context.sourceName ?? "generated").replace(/^@[^/]+\//, "").replace(/-/g, "_").replace(/@/g, "").replace(/\//g, "_");
	const packageName = workspace ? `${workspace}_${source}` : source;
	if (!existsSync(join(outRoot, "pubspec.yaml"))) scaffoldDartPackage(outRoot, packageName, tokens);
	const themeDir = join(outRoot, "lib", "core", "theme");
	const generatedDir = join(themeDir, "generated");
	mkdirSync(generatedDir, { recursive: true });
	const colorSchemeContent = generateColorScheme(tokens);
	const extensionsContent = generateThemeExtensions(tokens);
	const constantsContent = generateConstants(tokens);
	const themeContent = generateTheme(tokens, packageName);
	const COLOR_SCHEME_FILE = "color_scheme.generated.dart";
	const EXTENSIONS_FILE = "theme_extensions.generated.dart";
	const CONSTANTS_FILE = "constants.generated.dart";
	const generatedFiles = [
		COLOR_SCHEME_FILE,
		EXTENSIONS_FILE,
		CONSTANTS_FILE
	];
	writeFileSync(join(generatedDir, COLOR_SCHEME_FILE), colorSchemeContent, "utf-8");
	writeFileSync(join(generatedDir, EXTENSIONS_FILE), extensionsContent, "utf-8");
	writeFileSync(join(generatedDir, CONSTANTS_FILE), constantsContent, "utf-8");
	const barrelContent = generateBarrel(generatedFiles);
	writeFileSync(join(generatedDir, "generated.dart"), barrelContent, "utf-8");
	writeFileSync(join(themeDir, "theme.dart"), themeContent, "utf-8");
	mkdirSync(join(outRoot, "lib"), { recursive: true });
	const packageBarrelContent = generatePackageBarrel(packageName);
	writeFileSync(join(outRoot, "lib", `${packageName}.dart`), packageBarrelContent, "utf-8");
	return {
		success: true,
		duration: Math.round(performance.now() - start),
		summary: `${generatedFiles.length + 3} Dart files written`
	};
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
			const actions = [ACTION_PUB_GET];
			actions.push(STANDARD_ACTIONS.LINT);
			actions.push(STANDARD_ACTIONS.FORMAT);
			actions.push(STANDARD_ACTIONS.FORMAT_CHECK);
			if (hasDep(manifest, "build_runner", DART_DEP_FIELDS)) {
				actions.push(STANDARD_ACTIONS.BUILD);
				actions.push(ACTION_CODEGEN);
			}
			actions.push(STANDARD_ACTIONS.TEST);
			if (hasDep(manifest, "swagger_parser", DART_DEP_FIELDS)) actions.push(ACTION_GENERATE_API);
			return actions;
		} catch {
			return [ACTION_PUB_GET];
		}
	},
	async execute(action, pkg, root, context) {
		const cwd = join(root, pkg.path);
		let manifest;
		try {
			manifest = await readPubspec(pkg, root);
		} catch {
			manifest = {};
		}
		const flutter = isFlutterPackage(manifest);
		const dartCmd = flutter ? "flutter" : "dart";
		const analyzeCmd = flutter ? "flutter" : "dart";
		switch (action) {
			case STANDARD_ACTIONS.LINT: {
				const args = ["analyze"];
				if (context.lintDart?.strict) args.push("--fatal-infos");
				if (hasResolvedFiles(context)) args.push(...context.resolvedFiles);
				else args.push(".");
				return runCommand(analyzeCmd, args, cwd);
			}
			case STANDARD_ACTIONS.LINT_FIX:
				if (hasResolvedFiles(context)) return runCommand("dart", [
					"fix",
					"--apply",
					...context.resolvedFiles
				], cwd);
				return runCommand("dart", [
					"fix",
					"--apply",
					"."
				], cwd);
			case STANDARD_ACTIONS.FORMAT: {
				const args = ["format"];
				if (context.formatDart?.lineLength) args.push("--line-length", String(context.formatDart.lineLength));
				if (hasResolvedFiles(context)) args.push(...context.resolvedFiles);
				else {
					const libDir = join(cwd, "lib");
					const binDir = join(cwd, "bin");
					const targets = [libDir];
					if (existsSync(binDir)) targets.push(binDir);
					args.push(...targets);
				}
				return runCommand("dart", args, cwd);
			}
			case STANDARD_ACTIONS.FORMAT_CHECK: {
				const args = ["format", "--set-exit-if-changed"];
				if (context.formatDart?.lineLength) args.push("--line-length", String(context.formatDart.lineLength));
				if (hasResolvedFiles(context)) args.push(...context.resolvedFiles);
				else {
					const libDir = join(cwd, "lib");
					const binDir = join(cwd, "bin");
					const targets = [libDir];
					if (existsSync(binDir)) targets.push(binDir);
					args.push(...targets);
				}
				return runCommand("dart", args, cwd);
			}
			case STANDARD_ACTIONS.BUILD:
			case ACTION_CODEGEN: return runCommand("dart", [
				"run",
				"build_runner",
				"build",
				"--delete-conflicting-outputs"
			], cwd);
			case STANDARD_ACTIONS.TEST: return runCommand(flutter ? "flutter" : "dart", ["test"], cwd);
			case ACTION_PUB_GET: return runCommand(dartCmd, ["pub", "get"], cwd);
			case ACTION_GENERATE_API: return runCommand("dart", ["run", "swagger_parser"], cwd);
			case ACTION_GENERATE_OPENAPI_DART: {
				if (context.outputDir) return executeOpenAPIDartGeneration(pkg, root, context);
				const swaggerResult = await runCommand("dart", ["run", "swagger_parser"], cwd);
				if (!swaggerResult.success) return swaggerResult;
				return runCommand("dart", [
					"run",
					"build_runner",
					"build",
					"--delete-conflicting-outputs"
				], cwd);
			}
			case ACTION_GENERATE_DESIGN_TOKENS: return executeDesignTokenGeneration(pkg, root, context);
			default: return {
				success: false,
				duration: 0,
				summary: `Unknown action: ${action}`
			};
		}
	},
	async canHandleDomainArtifact(domain, _artifact, pkg, _root) {
		if (pkg.ecosystem !== "dart") return null;
		if (domain === "design-tokens") return {
			action: ACTION_GENERATE_DESIGN_TOKENS,
			description: "Flutter theme (M3 ColorScheme, extensions, constants)"
		};
		if (domain === "openapi") return {
			action: ACTION_GENERATE_OPENAPI_DART,
			description: "Dart client via swagger_parser + build_runner"
		};
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
//#region src/plugins/builtin/design/token-schema.ts
/** Matches all common CSS color notations: hex, rgb(a), hsl(a) */
const COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/;
/** Accepts hex (#RGB, #RRGGBB, #RRGGBBAA), rgb(a)(), and hsl(a)() color values */
const colorValue = z.string().refine((v) => COLOR_PATTERN.test(v), { message: "expected a CSS color: hex (#RGB/#RRGGBB/#RRGGBBAA), rgb(), rgba(), hsl(), or hsla()" });
const themedColor = z.object({
	light: colorValue,
	dark: colorValue
});
const nonNegativeNumber = z.number().nonnegative();
const shadowLayerSchema = z.object({
	x: z.number(),
	y: z.number(),
	blur: z.number().nonnegative(),
	spread: z.number(),
	color: colorValue,
	opacity: z.number().min(0).max(1)
});
const shadowArray = z.array(shadowLayerSchema);
const shadowPair = z.object({
	light: shadowArray,
	dark: shadowArray
});
const elevationEntrySchema = z.object({
	dp: z.number().nonnegative(),
	shadow: shadowPair
});
const fontProvider = z.enum([
	"asset",
	"google_fonts",
	"none"
]).default("asset");
const fontWeightMap = z.record(z.string(), z.number().int().min(100).max(900));
const typographyScaleEntrySchema = z.object({
	size: nonNegativeNumber,
	weight: z.string(),
	family: z.string(),
	letterSpacing: z.number().optional(),
	height: z.number().optional()
});
const typographySchema = z.object({
	provider: fontProvider,
	fontFamily: z.record(z.string(), z.string()),
	fontWeight: fontWeightMap,
	scale: z.record(z.string(), typographyScaleEntrySchema)
}).refine((data) => {
	for (const entry of Object.values(data.scale)) {
		if (!(entry.family in data.fontFamily)) return false;
		if (!(entry.weight in data.fontWeight)) return false;
	}
	return true;
}, { message: "typography.scale entries must reference valid fontFamily and fontWeight keys" });
/** Keys that mido recognizes as standard sections */
const STANDARD_KEYS = new Set([
	"meta",
	"brand",
	"color",
	"spacing",
	"radius",
	"elevation",
	"shadowCard",
	"iconSize",
	"typography"
]);
/** Required M3 ColorScheme fields */
const REQUIRED_COLOR_ROLES = [
	"primary",
	"onPrimary",
	"surface",
	"onSurface",
	"error",
	"onError"
];
/** Optional M3 ColorScheme fields — warn if missing */
const OPTIONAL_COLOR_ROLES = [
	"primaryContainer",
	"onPrimaryContainer",
	"secondary",
	"onSecondary",
	"secondaryContainer",
	"onSecondaryContainer",
	"tertiary",
	"onTertiary",
	"tertiaryContainer",
	"onTertiaryContainer",
	"errorContainer",
	"onErrorContainer",
	"surfaceDim",
	"surfaceBright",
	"surfaceContainerLowest",
	"surfaceContainerLow",
	"surfaceContainer",
	"surfaceContainerHigh",
	"surfaceContainerHighest",
	"onSurfaceVariant",
	"outline",
	"outlineVariant",
	"inverseSurface",
	"onInverseSurface",
	"inversePrimary",
	"scrim",
	"shadow"
];
const standardSchema = z.object({
	meta: z.record(z.string(), z.unknown()).optional(),
	brand: z.record(z.string(), colorValue).optional(),
	color: z.record(z.string(), themedColor),
	spacing: z.record(z.string(), nonNegativeNumber).optional(),
	radius: z.record(z.string(), nonNegativeNumber).optional(),
	elevation: z.record(z.string(), elevationEntrySchema).optional(),
	shadowCard: shadowPair.optional(),
	iconSize: z.record(z.string(), nonNegativeNumber).optional(),
	typography: typographySchema.optional()
});
/**
* Convert a section key to PascalCase class name.
* "extended" → "Extended", "genreColors" → "GenreColors"
*/
function toPascalCase(key) {
	return key.charAt(0).toUpperCase() + key.slice(1);
}
/**
* Convert a section key to camelCase getter name.
* "Extended" → "extended", "GenreColors" → "genreColors"
*/
function toCamelCase(key) {
	return key.charAt(0).toLowerCase() + key.slice(1);
}
/**
* Parse an extension section. Separates _metadata fields from token fields.
*/
function parseExtension(key, raw) {
	const errors = [];
	const fields = {};
	let className = toPascalCase(key);
	let getter = toCamelCase(key);
	for (const [fieldName, fieldValue] of Object.entries(raw)) {
		if (fieldName === "_className" && typeof fieldValue === "string") {
			className = fieldValue;
			continue;
		}
		if (fieldName === "_getter" && typeof fieldValue === "string") {
			getter = fieldValue;
			continue;
		}
		if (fieldName.startsWith("_")) continue;
		const result = themedColor.safeParse(fieldValue);
		if (result.success) fields[fieldName] = result.data;
		else errors.push({
			path: `${key}.${fieldName}`,
			message: `expected { light: color, dark: color }, got ${typeof fieldValue}`
		});
	}
	return {
		parsed: {
			meta: {
				className,
				getter
			},
			fields
		},
		errors
	};
}
/**
* Validate a parsed tokens.json against the mido-design token schema.
* Standard sections are validated by Zod. Any unknown top-level key
* is treated as a custom extension section.
*/
function validateTokens(raw) {
	const errors = [];
	const warnings = [];
	if (!isRecord(raw)) {
		errors.push({
			path: "(root)",
			message: "expected an object"
		});
		return {
			success: false,
			data: void 0,
			errors,
			warnings
		};
	}
	const obj = raw;
	const standardResult = standardSchema.safeParse(obj);
	if (!standardResult.success) {
		for (const issue of standardResult.error.issues) errors.push({
			path: issue.path.join(".") || "(root)",
			message: issue.message
		});
		return {
			success: false,
			data: void 0,
			errors,
			warnings
		};
	}
	const std = standardResult.data;
	for (const role of REQUIRED_COLOR_ROLES) if (!(role in std.color)) errors.push({
		path: `color.${role}`,
		message: "missing (required for M3 ColorScheme)"
	});
	if (errors.length > 0) return {
		success: false,
		data: void 0,
		errors,
		warnings
	};
	for (const role of OPTIONAL_COLOR_ROLES) if (!(role in std.color)) warnings.push({
		path: `color.${role}`,
		message: "missing optional M3 ColorScheme role"
	});
	const extensions = {};
	for (const key of Object.keys(obj)) {
		if (STANDARD_KEYS.has(key)) continue;
		const sectionValue = obj[key];
		if (!isRecord(sectionValue)) continue;
		const { parsed, errors: extErrors } = parseExtension(key, sectionValue);
		errors.push(...extErrors);
		extensions[key] = parsed;
	}
	if (errors.length > 0) return {
		success: false,
		data: void 0,
		errors,
		warnings
	};
	return {
		success: true,
		data: {
			standard: {
				brand: std.brand ?? {},
				color: std.color,
				spacing: std.spacing ?? {},
				radius: std.radius ?? {},
				elevation: std.elevation ?? {},
				shadowCard: std.shadowCard,
				iconSize: std.iconSize ?? {},
				typography: std.typography
			},
			extensions
		},
		errors,
		warnings
	};
}
//#endregion
//#region src/plugins/builtin/design/plugin.ts
const DOMAIN_NAME = "design-tokens";
/**
* Format validation errors for terminal output.
*/
function formatValidationErrors(errors, warnings) {
	const lines = [];
	lines.push(`${RED}✗ tokens.json validation failed${RESET}`);
	for (const err of errors) lines.push(`  ${RED}${err.path}: ${err.message}${RESET}`);
	for (const warn of warnings) lines.push(`  ${YELLOW}${warn.path}: ${warn.message}${RESET}`);
	return lines.join("\n");
}
/**
* Read and parse a token artifact file (JSON or YAML).
*/
async function readAndParseArtifact(artifactPath, root) {
	const content = await readFile(join(root, artifactPath), "utf-8");
	const ext = artifactPath.split(".").pop()?.toLowerCase();
	if (ext === "yaml" || ext === "yml") return parse(content);
	return JSON.parse(content);
}
/**
* Check if a parsed JSON object looks like a design tokens file.
* Must have a `color` key at the top level.
*/
function looksLikeTokens(raw) {
	if (typeof raw !== "object" || !raw) return false;
	return "color" in raw;
}
const designPlugin = {
	type: "domain",
	name: "design",
	async detectBridge(artifact, root) {
		const ext = artifact.split(".").pop()?.toLowerCase();
		if (!ext || ![
			"json",
			"yaml",
			"yml"
		].includes(ext)) return false;
		try {
			return looksLikeTokens(await readAndParseArtifact(artifact, root));
		} catch {
			return false;
		}
	},
	async exportArtifact(_source, artifact, root) {
		const start = performance.now();
		try {
			const result = validateTokens(await readAndParseArtifact(artifact, root));
			if (!result.success) {
				const output = formatValidationErrors(result.errors, result.warnings);
				return {
					success: false,
					duration: Math.round(performance.now() - start),
					summary: `tokens.json validation failed (${result.errors.length} error(s))`,
					output
				};
			}
			return {
				success: true,
				duration: Math.round(performance.now() - start),
				summary: "tokens valid"
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				success: false,
				duration: Math.round(performance.now() - start),
				summary: `Failed to read tokens.json: ${msg}`
			};
		}
	},
	async generateDownstream(artifact, targets, root, context) {
		const validation = validateTokens(await readAndParseArtifact(artifact, root));
		if (!validation.success || !validation.data) return [{
			success: false,
			duration: 0,
			summary: "tokens.json validation failed — cannot generate downstream"
		}];
		const handlers = await context.findEcosystemHandlers(DOMAIN_NAME, artifact);
		const targetPaths = new Set(targets.map((t) => t.path));
		const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));
		if (relevantHandlers.length === 0) return [];
		const sourcePath = artifact.split("/").slice(0, -1).join("/") || ".";
		const sourceName = context.graph.packages.get(sourcePath)?.name ?? sourcePath.split("/").pop() ?? "generated";
		const results = [];
		for (const handler of relevantHandlers) {
			const outputDir = join(root, sourcePath, "generated", handler.plugin.name);
			mkdirSync(outputDir, { recursive: true });
			const ctxWithTokens = {
				...context,
				sourceName,
				artifactPath: artifact,
				domainData: validation.data,
				outputDir
			};
			const result = await handler.plugin.execute(handler.capability.action, handler.pkg, root, ctxWithTokens);
			results.push(result);
		}
		return results;
	},
	async buildPipeline(_source, artifact, targets, root, context) {
		const steps = [];
		const shared = { data: void 0 };
		steps.push({
			name: "validate-tokens",
			plugin: "design",
			description: "validating tokens...",
			outputPaths: [artifact],
			execute: async () => {
				const start = performance.now();
				try {
					const result = validateTokens(await readAndParseArtifact(artifact, root));
					if (!result.success) {
						const output = formatValidationErrors(result.errors, result.warnings);
						return {
							success: false,
							duration: Math.round(performance.now() - start),
							summary: "tokens.json validation failed",
							output
						};
					}
					shared.data = result.data;
					return {
						success: true,
						duration: Math.round(performance.now() - start),
						summary: "tokens valid"
					};
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return {
						success: false,
						duration: Math.round(performance.now() - start),
						summary: `Failed to read tokens.json: ${msg}`
					};
				}
			}
		});
		const handlers = await context.findEcosystemHandlers(DOMAIN_NAME, artifact);
		const targetPaths = new Set(targets.map((t) => t.path));
		const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));
		const seenEcosystems = /* @__PURE__ */ new Set();
		for (const handler of relevantHandlers) {
			if (seenEcosystems.has(handler.plugin.name)) continue;
			seenEcosystems.add(handler.plugin.name);
			const outputDir = join(root, _source.path, "generated", handler.plugin.name);
			steps.push({
				name: `generate-${handler.plugin.name}`,
				plugin: handler.plugin.name,
				description: `${handler.capability.description}...`,
				execute: async () => {
					if (!shared.data) return {
						success: false,
						duration: 0,
						summary: "Cannot generate — token validation did not run"
					};
					mkdirSync(outputDir, { recursive: true });
					const ctxWithTokens = {
						...context,
						sourceName: _source.name,
						artifactPath: artifact,
						domainData: shared.data,
						outputDir
					};
					return handler.plugin.execute(handler.capability.action, handler.pkg, root, ctxWithTokens);
				}
			});
		}
		return steps;
	}
};
//#endregion
//#region src/plugins/builtin/openapi/server-boot.ts
/** Default timeout waiting for server to accept connections (ms) */
const DEFAULT_STARTUP_TIMEOUT = 15e3;
/** How often to poll the server during startup (ms) */
const POLL_INTERVAL = 500;
/** Max time to wait for graceful shutdown before SIGKILL (ms) */
const KILL_TIMEOUT = 3e3;
/** Maximum bytes of child output to capture */
const MAX_OUTPUT_BYTES = 256 * 1024;
/** Maximum bytes of HTTP response body to consume from spec endpoint */
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
/** Find a free port by binding to port 0 and closing immediately */
async function findFreePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(/* @__PURE__ */ new Error("Could not allocate a free port"));
				return;
			}
			const port = address.port;
			server.close(() => resolve(port));
		});
		server.on("error", reject);
	});
}
/** Well-known entry files checked in order */
const ENTRY_CANDIDATES = [
	"src/index.ts",
	"src/main.ts",
	"src/app.ts",
	"index.ts",
	"main.ts",
	"app.ts"
];
/**
* Parse an entry file from a script value.
* Handles patterns like: "bun run --watch src/index.ts", "tsx src/index.ts",
* "node dist/index.js", "ts-node src/main.ts"
*/
function parseEntryFromScript(script) {
	return /(?:^|\s)(\S+\.(?:ts|js|mjs|mts))(?:\s|$)/.exec(script)?.[1] ?? null;
}
/**
* Auto-detect the server entry file from an absolute package directory.
* Priority: main field → dev script → start script → well-known paths.
*/
async function detectEntryFile(packageDir) {
	try {
		const content = await readFile(join(packageDir, "package.json"), "utf-8");
		const parsed = JSON.parse(content);
		if (!isRecord(parsed)) throw new Error("Expected object");
		const main = parsed["main"];
		if (typeof main === "string" && existsSync(join(packageDir, main))) return main;
		const scripts = getScripts(parsed);
		for (const scriptName of ["dev", "start"]) {
			const script = scripts[scriptName];
			if (!script) continue;
			const entry = parseEntryFromScript(script);
			if (entry && existsSync(join(packageDir, entry))) return entry;
		}
	} catch {}
	for (const candidate of ENTRY_CANDIDATES) if (existsSync(join(packageDir, candidate))) return candidate;
	return null;
}
/** Kill a child process gracefully, then forcefully if needed */
function killProcess(child) {
	return new Promise((resolve) => {
		if (!child.pid) {
			resolve();
			return;
		}
		let resolved = false;
		const cleanup = () => {
			if (!resolved) {
				resolved = true;
				resolve();
			}
		};
		child.on("exit", cleanup);
		child.on("error", cleanup);
		child.kill("SIGTERM");
		setTimeout(() => {
			if (!resolved && child.pid) try {
				child.kill("SIGKILL");
			} catch {}
			cleanup();
		}, KILL_TIMEOUT);
	});
}
/**
* Poll until the server responds on the given port.
* Returns true if the server started, false on timeout.
*/
async function waitForServer(port, timeout) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 2e3);
		try {
			(await fetch(`http://127.0.0.1:${String(port)}/`, {
				signal: controller.signal,
				redirect: "error"
			})).body?.cancel();
			return true;
		} catch {} finally {
			clearTimeout(timer);
		}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL));
	}
	return false;
}
/**
* Try fetching the spec from a list of paths.
* Returns the parsed JSON and the path that worked, or null with attempt details.
*/
async function fetchSpec(port, paths) {
	const attempts = [];
	for (const specPath of paths) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 1e4);
		try {
			const url = `http://127.0.0.1:${String(port)}${specPath}`;
			const response = await fetch(url, {
				signal: controller.signal,
				redirect: "error"
			});
			if (!response.ok) {
				attempts.push({
					path: specPath,
					status: response.status,
					error: null
				});
				response.body?.cancel();
				continue;
			}
			const contentLength = response.headers.get("content-length");
			if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
				attempts.push({
					path: specPath,
					status: response.status,
					error: "response too large"
				});
				response.body?.cancel();
				continue;
			}
			const text = await response.text();
			if (text.length > MAX_RESPONSE_BYTES) {
				attempts.push({
					path: specPath,
					status: response.status,
					error: "response body too large"
				});
				continue;
			}
			let body;
			try {
				body = JSON.parse(text);
			} catch {
				attempts.push({
					path: specPath,
					status: response.status,
					error: "invalid JSON"
				});
				continue;
			}
			if (!isRecord(body)) {
				attempts.push({
					path: specPath,
					status: response.status,
					error: "response is not a JSON object"
				});
				continue;
			}
			if (!("openapi" in body) && !("swagger" in body)) {
				attempts.push({
					path: specPath,
					status: response.status,
					error: "missing openapi/swagger key"
				});
				continue;
			}
			return {
				spec: body,
				path: specPath,
				attempts
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			attempts.push({
				path: specPath,
				status: null,
				error: msg
			});
			continue;
		} finally {
			clearTimeout(timer);
		}
	}
	return {
		spec: null,
		path: null,
		attempts
	};
}
/** Format fetch attempts into a readable diagnostic string */
function formatAttempts(attempts) {
	if (attempts.length === 0) return "";
	return attempts.map((a) => {
		if (a.status) return `  ${a.path} → ${String(a.status)}${a.error ? ` (${a.error})` : ""}`;
		return `  ${a.path} → ${a.error ?? "unknown error"}`;
	}).join("\n");
}
/**
* Boot a server process on a free port.
* Returns the child process, port, and associated cleanup handlers.
*/
function spawnServer(packageDir, pm, entryFile, port, debug) {
	const runnerArgs = pm === "bun" ? ["run", entryFile] : ["tsx", entryFile];
	const runner = pm === "bun" ? "bun" : "npx";
	debug?.(`spawning: ${runner} ${runnerArgs.join(" ")} (cwd: ${packageDir})`);
	const child = spawn(runner, runnerArgs, {
		cwd: packageDir,
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		env: {
			PATH: process.env["PATH"],
			HOME: process.env["HOME"],
			NODE_ENV: process.env["NODE_ENV"],
			PORT: String(port)
		}
	});
	const exitHandler = () => {
		try {
			child.kill("SIGKILL");
		} catch {}
	};
	process.on("exit", exitHandler);
	const outputChunks = [];
	let totalBytes = 0;
	const collectOutput = (data) => {
		if (totalBytes < MAX_OUTPUT_BYTES) {
			outputChunks.push(data.toString());
			totalBytes += data.length;
		}
	};
	child.stdout?.on("data", collectOutput);
	child.stderr?.on("data", collectOutput);
	const earlyExitRef = {
		earlyExit: false,
		exitCode: null
	};
	child.on("exit", (code) => {
		earlyExitRef.earlyExit = true;
		earlyExitRef.exitCode = code;
		debug?.(`server process exited with code ${String(code)}`);
	});
	return {
		child,
		port,
		exitHandler,
		outputChunks,
		earlyExitRef
	};
}
//#endregion
//#region src/plugins/builtin/openapi/exporter.ts
/**
* Assert that a resolved path stays within the workspace root.
* Prevents path traversal via malicious config values.
*/
function assertWithinRoot(filePath, root) {
	const resolved = resolve(filePath);
	const resolvedRoot = resolve(root);
	const normalizedRoot = resolvedRoot.endsWith("/") ? resolvedRoot : `${resolvedRoot}/`;
	if (!(resolved.endsWith("/") ? resolved : `${resolved}/`).startsWith(normalizedRoot) && resolved !== resolvedRoot) throw new Error(`Path "${filePath}" escapes workspace root "${root}"`);
}
/**
* Export an OpenAPI spec by booting the server, fetching the spec endpoint,
* writing it to disk, and killing the server.
*/
async function exportSpec(options) {
	const { packageDir, pm, adapter, outputPath, startupTimeout = DEFAULT_STARTUP_TIMEOUT, verbose = false } = options;
	const start = performance.now();
	const debug = verbose ? (msg) => console.error(`  [exporter] ${msg}`) : void 0;
	const entryFile = options.entryFile ?? await detectEntryFile(packageDir);
	debug?.(`entry file: ${entryFile ?? "not found"}`);
	if (entryFile) assertWithinRoot(join(packageDir, entryFile), packageDir);
	if (!entryFile) return {
		success: false,
		duration: Math.round(performance.now() - start),
		summary: `Could not detect entry file in ${packageDir}. Set entryFile on the bridge.`
	};
	let port;
	try {
		port = await findFreePort();
		debug?.(`allocated port ${String(port)}`);
	} catch {
		return {
			success: false,
			duration: Math.round(performance.now() - start),
			summary: "Port allocation failed. Check if another mido dev instance is running."
		};
	}
	const server = spawnServer(packageDir, pm, entryFile, port, debug);
	try {
		debug?.(`polling http://127.0.0.1:${String(port)}/ (timeout: ${String(startupTimeout)}ms)`);
		const ready = await waitForServer(port, startupTimeout);
		debug?.(`server ready: ${String(ready)}, earlyExit: ${String(server.earlyExitRef.earlyExit)}`);
		if (!ready) {
			const serverOutput = server.outputChunks.join("");
			const timeoutSec = Math.round(startupTimeout / 1e3);
			const reason = server.earlyExitRef.earlyExit ? `Server exited with code ${String(server.earlyExitRef.exitCode)} before becoming ready` : `Server didn't start within ${String(timeoutSec)}s`;
			return {
				success: false,
				duration: Math.round(performance.now() - start),
				summary: `${reason}. Entry: ${entryFile}`,
				output: serverOutput || void 0
			};
		}
		const specPathOverride = options.specPath;
		const normalize = (p) => p.startsWith("/") ? p : `/${p}`;
		const pathsToTry = specPathOverride ? [normalize(specPathOverride)] : [adapter.defaultSpecPath, ...adapter.fallbackSpecPaths];
		debug?.(`fetching spec from: ${pathsToTry.join(", ")}`);
		const result = await fetchSpec(port, pathsToTry);
		debug?.(`fetch result: ${result.spec ? `found at ${result.path}` : "not found"}`);
		if (!result.spec) {
			const serverOutput = server.outputChunks.join("");
			const attemptDetails = formatAttempts(result.attempts);
			const details = [attemptDetails ? `Endpoints tried:\n${attemptDetails}` : "", serverOutput ? `Server output:\n${serverOutput.trim().split("\n").slice(0, 10).join("\n")}` : ""].filter(Boolean).join("\n");
			return {
				success: false,
				duration: Math.round(performance.now() - start),
				summary: "Could not find OpenAPI spec. Add an openapi:export script as fallback.",
				output: details || void 0
			};
		}
		debug?.(`writing spec to ${outputPath}`);
		try {
			const outputDir = dirname(outputPath);
			if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true });
			await writeFile(outputPath, JSON.stringify(result.spec, null, 2) + "\n", "utf-8");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				success: false,
				duration: Math.round(performance.now() - start),
				summary: `Failed to write spec: ${msg}`
			};
		}
		debug?.(`export complete`);
		return {
			success: true,
			duration: Math.round(performance.now() - start),
			summary: `exported from ${result.path}`
		};
	} finally {
		debug?.(`killing server process`);
		await killProcess(server.child);
		process.removeListener("exit", server.exitHandler);
	}
}
/**
* Detect a framework adapter for a package.
* Reads the package.json and checks all adapters.
*/
async function detectFrameworkAdapter(pkgPath, root) {
	const { detectAdapter } = await import("./adapters-CE66Q9nV.js");
	try {
		const manifest = await readPackageJson(pkgPath, root);
		const allDeps = {};
		for (const field of [
			"dependencies",
			"devDependencies",
			"peerDependencies"
		]) {
			const deps = manifest[field];
			if (isRecord(deps)) {
				for (const [name, version] of Object.entries(deps)) if (typeof version === "string") allDeps[name] = version;
			}
		}
		return detectAdapter(allDeps);
	} catch {
		return null;
	}
}
//#endregion
//#region src/plugins/builtin/openapi/plugin.ts
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
	["koa", ["src/routes/**", "routes/**"]],
	["@nestjs/core", ["src/**/*.controller.ts", "src/**/*.ts"]]
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
* actually produces the routes. Returns the package and its adapter.
* Only scans TypeScript packages — other ecosystems are not yet supported.
*/
async function findServerPackage(packages, root) {
	for (const [, pkg] of packages) {
		if (pkg.ecosystem !== "typescript") continue;
		const adapter = await detectFrameworkAdapter(pkg.path, root);
		if (adapter) return {
			path: pkg.path,
			adapter
		};
	}
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
			for (const [framework, defaultPatterns] of SERVER_FRAMEWORKS) if (hasDep(manifest, framework)) return {
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
/**
* Try exporting the spec using the adapter-based exporter.
* Scans workspace packages for a server framework, boots it, and fetches the spec.
*/
async function tryAdapterExport(source, artifact, root, context) {
	let adapter = await detectFrameworkAdapter(source.path, root);
	let serverPkgPath = source.path;
	if (!adapter) {
		const serverInfo = await findServerPackage(context.graph.packages, root);
		if (!serverInfo) return null;
		adapter = serverInfo.adapter;
		serverPkgPath = serverInfo.path;
	}
	const packageDir = resolve(root, serverPkgPath);
	const outputPath = resolve(root, artifact);
	assertWithinRoot(packageDir, root);
	assertWithinRoot(outputPath, root);
	const bridge = context.graph.bridges.find((b) => b.source === source.path && b.artifact === artifact);
	return exportSpec({
		packageDir,
		pm: context.packageManager,
		adapter,
		outputPath,
		entryFile: bridge?.entryFile,
		specPath: bridge?.specPath,
		verbose: context.verbose
	});
}
const openapiPlugin = {
	type: "domain",
	name: "openapi",
	async detectBridge(artifact) {
		const filename = basename(artifact);
		return OPENAPI_FILENAMES.has(filename);
	},
	async exportArtifact(source, artifact, root, context) {
		const adapterResult = await tryAdapterExport(source, artifact, root, context);
		if (adapterResult?.success) return adapterResult;
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
			summary: `No export method found for ${source.path} — install an OpenAPI plugin for your framework or add an openapi:export script`
		};
	},
	async generateDownstream(artifact, targets, root, context) {
		const resolvedArtifact = resolveArtifactForDownstream(artifact, root);
		const handlers = await context.findEcosystemHandlers("openapi", resolvedArtifact);
		const targetPaths = new Set(targets.map((t) => t.path));
		const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));
		if (relevantHandlers.length === 0) return [];
		const sourcePath = artifact.split("/").slice(0, -1).join("/") || ".";
		const sourceName = context.graph.packages.get(sourcePath)?.name ?? sourcePath.split("/").pop() ?? "generated";
		const results = [];
		for (const handler of relevantHandlers) {
			const outputDir = join(root, sourcePath, "generated", handler.plugin.name);
			mkdirSync(outputDir, { recursive: true });
			const ctxWithArtifact = {
				...context,
				sourceName,
				artifactPath: resolvedArtifact,
				outputDir
			};
			const result = await handler.plugin.execute(handler.capability.action, handler.pkg, root, ctxWithArtifact);
			results.push(result);
		}
		return results;
	},
	async buildPipeline(source, artifact, targets, root, context) {
		const steps = [];
		const ext = artifact.includes(".") ? artifact.slice(artifact.lastIndexOf(".")) : "";
		const base = artifact.slice(0, artifact.length - ext.length);
		if (!existsSync(join(root, artifact))) steps.push({
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
		const seenEcosystems = /* @__PURE__ */ new Set();
		for (const handler of relevantHandlers) {
			if (seenEcosystems.has(handler.plugin.name)) continue;
			seenEcosystems.add(handler.plugin.name);
			const outputDir = join(root, source.path, "generated", handler.plugin.name);
			steps.push({
				name: `generate-${handler.plugin.name}`,
				plugin: handler.plugin.name,
				description: `${handler.capability.description}...`,
				execute: () => {
					mkdirSync(outputDir, { recursive: true });
					const ctxWithArtifact = {
						...context,
						sourceName: source.name,
						artifactPath: downstreamArtifact,
						outputDir
					};
					return handler.plugin.execute(handler.capability.action, handler.pkg, root, ctxWithArtifact);
				}
			});
		}
		return steps;
	},
	async suggestWatchPaths(source, _artifact, packages, root) {
		try {
			const manifest = await readPackageJson(source.path, root);
			for (const [framework] of SERVER_FRAMEWORKS) if (hasDep(manifest, framework)) return {
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
		domain: [designPlugin, openapiPlugin]
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
	createContext(graph, root, packageManager, options) {
		return {
			graph,
			root,
			packageManager,
			verbose: options?.verbose,
			lintTypescript: options?.lintConfig?.typescript,
			lintDart: options?.lintConfig?.dart,
			formatTypescript: options?.formatConfig?.typescript,
			formatDart: options?.formatConfig?.dart,
			findEcosystemHandlers: async (domain, artifact) => {
				const bridgeTargetPaths = /* @__PURE__ */ new Set();
				for (const bridge of graph.bridges) for (const consumer of bridge.consumers) bridgeTargetPaths.add(consumer);
				const targets = [...graph.packages.values()].filter((p) => bridgeTargetPaths.has(p.path));
				return this.findEcosystemHandlers(domain, artifact, targets, root);
			}
		};
	}
};
//#endregion
export { loadPlugins as n, STANDARD_ACTIONS as r, PluginRegistry as t };

//# sourceMappingURL=registry-C8GTLy-v.js.map