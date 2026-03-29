#!/usr/bin/env node
import { r as isRecord, t as MIDO_ROOT } from "./version-M9xRTj7S.js";
import { f as YELLOW, l as RED, u as RESET } from "./output-MbJ98jNX.js";
import { t as runCommand } from "./process-ByVI-buF.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { parse } from "yaml";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
//#region src/plugins/builtin/shared/exec.ts
/** Check if the execution context has pre-resolved file paths */
function hasResolvedFiles(context) {
	return !!context.resolvedFiles && context.resolvedFiles.length > 0;
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
//#endregion
//#region src/plugins/builtin/ecosystem/typescript/asset-codegen.ts
const HEADER$4 = "/* GENERATED — DO NOT EDIT. Changes will be overwritten. */";
/** Maximum SVG file size (bytes) to inline. Larger files are skipped. */
const MAX_INLINE_SIZE = 64 * 1024;
/**
* Convert a key to a valid TypeScript identifier (camelCase).
* Keys starting with a digit get a `$` prefix.
*/
function toCamelCase$2(str) {
	const parts = str.split(/[_\-]/).filter((p) => p.length > 0);
	if (parts.length === 0) return str;
	const result = (parts[0] ?? "") + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
	if (/^\d/.test(result)) return `$${result}`;
	return result;
}
/**
* Convert a category name to PascalCase.
*/
function toPascalCase$3(str) {
	return str.split(/[_\-/]/).filter((part) => part.length > 0).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}
/**
* Escape a string for safe embedding in a single-quoted JS string.
*/
function escapeSingleQuoted(str) {
	return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
/**
* Escape content for safe embedding in a template literal.
* Order matters: backslashes first, then backticks, then ${}.
*/
function escapeTemplateLiteral(str) {
	return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}
/**
* Narrow unknown domainData to AssetManifest.
*/
function isAssetManifest$1(value) {
	if (!isRecord(value)) return false;
	return typeof value["workspaceName"] === "string" && Array.isArray(value["categories"]) && Array.isArray(value["allEntries"]);
}
/**
* Generate TypeScript exports for an assets package.
*
* Two output files:
* - `paths.ts` — Typed path constants for each asset
* - `inline.ts` — Inlined SVG content as template literal strings (< 64KB only)
*/
async function executeTypescriptAssetGeneration(_pkg, root, context) {
	const start = performance.now();
	if (!isAssetManifest$1(context.domainData)) return {
		success: false,
		duration: 0,
		summary: "No asset manifest provided — assets plugin must scan first"
	};
	const manifest = context.domainData;
	const outDir = context.outputDir;
	if (!outDir) return {
		success: false,
		duration: 0,
		summary: "No outputDir provided"
	};
	mkdirSync(outDir, { recursive: true });
	const sourcePath = context.artifactPath;
	const sourceDir = sourcePath ? join(root, sourcePath) : null;
	const themedEntryPaths = /* @__PURE__ */ new Set();
	for (const variant of manifest.themeVariants) for (const [, entries] of variant.variants) for (const entry of entries) themedEntryPaths.add(entry.relativePath);
	const regularCategories = manifest.categories.map((cat) => ({
		...cat,
		entries: cat.entries.filter((e) => !themedEntryPaths.has(e.relativePath))
	})).filter((cat) => cat.entries.length > 0);
	const pathLines = [HEADER$4, ""];
	let hasPathContent = false;
	for (const category of regularCategories) {
		hasPathContent = true;
		const constName = `${toPascalCase$3(category.name)}Paths`;
		pathLines.push(`export const ${constName} = {`);
		for (const entry of category.entries) {
			const key = toCamelCase$2(entry.key);
			pathLines.push(`  ${key}: '${escapeSingleQuoted(entry.relativePath)}',`);
		}
		pathLines.push("} as const;");
		pathLines.push("");
		pathLines.push(`export type ${toPascalCase$3(category.name)}Key = keyof typeof ${constName};`);
		pathLines.push("");
	}
	for (const variant of manifest.themeVariants) for (const [variantName, entries] of variant.variants) {
		const constName = `${toPascalCase$3(variant.category)}${toPascalCase$3(variantName)}Paths`;
		pathLines.push(`export const ${constName} = {`);
		hasPathContent = true;
		for (const entry of entries) {
			const key = toCamelCase$2(entry.key);
			pathLines.push(`  ${key}: '${escapeSingleQuoted(entry.relativePath)}',`);
		}
		pathLines.push("} as const;");
		pathLines.push("");
	}
	if (hasPathContent) writeFileSync(join(outDir, "paths.ts"), pathLines.join("\n"), "utf-8");
	const svgEntries = manifest.allEntries.filter((e) => e.ext === "svg");
	let inlinedCount = 0;
	let skippedCount = 0;
	if (svgEntries.length > 0 && sourceDir) {
		const inlineLines = [HEADER$4, ""];
		for (const category of regularCategories) {
			const svgInCategory = category.entries.filter((e) => e.ext === "svg");
			if (svgInCategory.length === 0) continue;
			const constName = `${toPascalCase$3(category.name)}Inline`;
			const entries = [];
			for (const entry of svgInCategory) {
				const absPath = join(sourceDir, entry.relativePath);
				if (!existsSync(absPath)) continue;
				const content = readFileSync(absPath, "utf-8");
				if (content.length > MAX_INLINE_SIZE) {
					skippedCount++;
					continue;
				}
				const key = toCamelCase$2(entry.key);
				const escaped = escapeTemplateLiteral(content.trim());
				entries.push(`  ${key}: \`${escaped}\`,`);
				inlinedCount++;
			}
			if (entries.length > 0) {
				inlineLines.push(`export const ${constName} = {`);
				inlineLines.push(...entries);
				inlineLines.push("} as const;");
				inlineLines.push("");
			}
		}
		if (inlinedCount > 0) writeFileSync(join(outDir, "inline.ts"), inlineLines.join("\n"), "utf-8");
	}
	const workspace = context.graph.name;
	const rawSource = (context.sourceName ?? "assets").replace(/^@[^/]+\//, "");
	const pkgName = workspace ? `@${workspace}/${rawSource}` : rawSource;
	const exports = { ".": "./index.ts" };
	if (hasPathContent) exports["./paths"] = "./paths.ts";
	if (inlinedCount > 0) exports["./inline"] = "./inline.ts";
	const pkgJson = {
		name: pkgName,
		version: "0.0.0",
		private: true,
		main: "index.ts",
		exports
	};
	writeFileSync(join(outDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
	const indexLines = [HEADER$4, ""];
	if (hasPathContent) indexLines.push("export * from './paths';");
	if (inlinedCount > 0) indexLines.push("export * from './inline';");
	indexLines.push("");
	writeFileSync(join(outDir, "index.ts"), indexLines.join("\n"), "utf-8");
	const duration = Math.round(performance.now() - start);
	const fileCount = 2 + (inlinedCount > 0 ? 1 : 0);
	const skippedNote = skippedCount > 0 ? `, ${skippedCount} SVGs skipped (>${MAX_INLINE_SIZE / 1024}KB)` : "";
	return {
		success: true,
		duration,
		summary: `${fileCount} file(s) written (${manifest.allEntries.length} paths, ${inlinedCount} inlined SVGs${skippedNote})`
	};
}
//#endregion
//#region src/plugins/builtin/ecosystem/typescript/token-codegen.ts
const HEADER$3 = `/* GENERATED — DO NOT EDIT. Changes will be overwritten. */`;
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
	const lines = [HEADER$3, ""];
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
	const lines = [HEADER$3, ""];
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
//#region src/plugins/builtin/ecosystem/typescript/openapi-codegen.ts
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
//#region src/plugins/builtin/ecosystem/typescript/lint-config.ts
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
//#region src/plugins/builtin/ecosystem/typescript/plugin.ts
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
/** Action name for asset path/inline generation */
const ACTION_GENERATE_ASSETS_TS = "generate-assets-ts";
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
		if (action === ACTION_GENERATE_ASSETS_TS) return executeTypescriptAssetGeneration(pkg, root, context);
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
		if (domain === "assets") return {
			action: ACTION_GENERATE_ASSETS_TS,
			description: "TypeScript asset paths + inlined SVGs"
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
//#region src/plugins/builtin/ecosystem/dart/token-theme.ts
const HEADER$2 = `// GENERATED — DO NOT EDIT. Changes will be overwritten.`;
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
* Convert a font family name to a GoogleFonts method name.
* e.g., "Playfair Display" → "playfairDisplay", "Merriweather" → "merriweather"
*/
function toGoogleFontsMethod(familyName) {
	return familyName.split(" ").map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)).join("");
}
/**
* Generate a font style expression for the given provider.
*/
function fontStyleExpr(provider, familyName, opts) {
	if (provider === "google_fonts") return `GoogleFonts.${toGoogleFontsMethod(familyName)}(fontSize: ${opts.size}, fontWeight: FontWeight.w${opts.weight}, color: ${opts.color})`;
	if (provider === "asset") return `TextStyle(fontFamily: '${familyName}', fontSize: ${opts.size}, fontWeight: FontWeight.w${opts.weight}, color: ${opts.color})`;
	return `TextStyle(fontSize: ${opts.size}, fontWeight: FontWeight.w${opts.weight}, color: ${opts.color})`;
}
/**
* Generate a short font style expression (no color — for button text styles, etc.)
*/
function fontStyleExprNoColor(provider, familyName, opts) {
	if (provider === "google_fonts") return `GoogleFonts.${toGoogleFontsMethod(familyName)}(fontSize: ${opts.size}, fontWeight: FontWeight.w${opts.weight})`;
	if (provider === "asset") return `TextStyle(fontFamily: '${familyName}', fontSize: ${opts.size}, fontWeight: FontWeight.w${opts.weight})`;
	return `TextStyle(fontSize: ${opts.size}, fontWeight: FontWeight.w${opts.weight})`;
}
/**
* Generate ThemeExtension classes — one per custom extension section.
* All extension fields are themed colors (light/dark pairs).
*/
function generateThemeExtensions(tokens) {
	const extEntries = Object.entries(tokens.extensions);
	if (extEntries.length === 0) return `${HEADER$2}\n\n// No extensions defined in tokens.json\n`;
	const lines = [
		HEADER$2,
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
		lines.push("");
		const firstField = fieldNames[0] ?? "brand";
		lines.push("  /// Look up a color by its key name. Returns first color for unknown keys.");
		lines.push("  Color byKey(String key) => switch (key) {");
		for (const name of fieldNames) {
			const kebab = name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
			if (kebab !== name) lines.push(`    '${kebab}' || '${name}' => ${name},`);
			else lines.push(`    '${name}' => ${name},`);
		}
		lines.push(`    _ => ${firstField},`);
		lines.push("  };");
		lines.push("}");
		index++;
		if (index < extEntries.length) lines.push("");
	}
	lines.push("");
	return lines.join("\n");
}
/**
* Generate the full ThemeData assembly file with M3 widget themes.
*/
function generateTheme(tokens, packageName) {
	const extEntries = Object.entries(tokens.extensions);
	const typo = tokens.standard.typography;
	const provider = typo?.provider ?? "asset";
	const uiFontFamily = typo?.fontFamily["sans"] ?? typo?.fontFamily["body"] ?? Object.values(typo?.fontFamily ?? {})[0] ?? "sans-serif";
	const hasSpacing = Object.keys(tokens.standard.spacing).length > 0;
	const hasRadius = Object.keys(tokens.standard.radius).length > 0;
	const hasElevation = Object.keys(tokens.standard.elevation).length > 0;
	const hasIconSize = Object.keys(tokens.standard.iconSize).length > 0;
	const lines = [HEADER$2, ""];
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
	if (typo?.fontFamily) lines.push(`      fontFamily: '${uiFontFamily}',`);
	lines.push("      textTheme: _buildTextTheme(scheme),");
	lines.push("");
	lines.push("      // AppBar");
	lines.push("      appBarTheme: AppBarTheme(");
	if (hasElevation) {
		lines.push("        elevation: DSElevation.none,");
		lines.push("        scrolledUnderElevation: DSElevation.lg,");
	}
	lines.push("        backgroundColor: scheme.surface,");
	lines.push("        foregroundColor: scheme.onSurface,");
	lines.push("        surfaceTintColor: scheme.surfaceTint,");
	lines.push("        centerTitle: true,");
	lines.push(`        titleTextStyle: ${fontStyleExpr(provider, uiFontFamily, {
		size: 22,
		weight: 600,
		color: "scheme.onSurface"
	})},`);
	if (hasIconSize) lines.push("        iconTheme: IconThemeData(size: DSIconSize.md),");
	lines.push("      ),");
	lines.push("");
	lines.push("      // BottomSheet");
	lines.push("      bottomSheetTheme: BottomSheetThemeData(");
	lines.push("        backgroundColor: scheme.surface,");
	lines.push("        modalBackgroundColor: scheme.surface,");
	if (hasElevation) {
		lines.push("        elevation: DSElevation.none,");
		lines.push("        modalElevation: DSElevation.none,");
	}
	if (hasRadius) {
		lines.push("        shape: const RoundedRectangleBorder(");
		lines.push("          borderRadius: BorderRadius.vertical(top: Radius.circular(DSRadius.xl)),");
		lines.push("        ),");
	}
	lines.push("        surfaceTintColor: Colors.transparent,");
	lines.push("        showDragHandle: true,");
	lines.push("        dragHandleColor: scheme.onSurfaceVariant.withValues(alpha: 0.4),");
	lines.push("        dragHandleSize: const Size(32, 4),");
	lines.push("      ),");
	lines.push("");
	lines.push("      // Dialog");
	lines.push("      dialogTheme: DialogThemeData(");
	lines.push("        backgroundColor: scheme.surfaceContainerHigh,");
	if (hasElevation) lines.push("        elevation: DSElevation.xxl,");
	if (hasRadius) lines.push("        shape: RoundedRectangleBorder(borderRadius: DSRadius.xlAll),");
	lines.push("        surfaceTintColor: scheme.surfaceTint,");
	lines.push("      ),");
	lines.push("");
	lines.push("      // Card");
	lines.push("      cardTheme: CardThemeData(");
	if (hasElevation) lines.push("        elevation: DSElevation.sm,");
	lines.push("        color: scheme.surfaceContainerLow,");
	lines.push("        surfaceTintColor: scheme.surfaceTint,");
	if (hasRadius) {
		lines.push("        shape: RoundedRectangleBorder(");
		lines.push("          borderRadius: DSRadius.lgAll,");
		lines.push("          side: BorderSide(color: scheme.outlineVariant),");
		lines.push("        ),");
	}
	lines.push("        margin: EdgeInsets.zero,");
	lines.push("      ),");
	lines.push("");
	const btnTextStyle = fontStyleExprNoColor(provider, uiFontFamily, {
		size: 14,
		weight: 600
	});
	lines.push("      // Buttons");
	lines.push("      filledButtonTheme: FilledButtonThemeData(");
	lines.push("        style: FilledButton.styleFrom(");
	if (hasElevation) lines.push("          elevation: DSElevation.none,");
	if (hasRadius) lines.push("          shape: RoundedRectangleBorder(borderRadius: DSRadius.mdAll),");
	if (hasSpacing) lines.push("          padding: const EdgeInsets.symmetric(horizontal: DSSpacing.lg, vertical: DSSpacing.md),");
	lines.push("          minimumSize: const Size(64, 48),");
	lines.push(`          textStyle: ${btnTextStyle},`);
	lines.push("        ),");
	lines.push("      ),");
	lines.push("      elevatedButtonTheme: ElevatedButtonThemeData(");
	lines.push("        style: ElevatedButton.styleFrom(");
	if (hasElevation) lines.push("          elevation: DSElevation.sm,");
	if (hasRadius) lines.push("          shape: RoundedRectangleBorder(borderRadius: DSRadius.mdAll),");
	lines.push("          backgroundColor: scheme.surfaceContainerLow,");
	lines.push("          foregroundColor: scheme.primary,");
	if (hasSpacing) lines.push("          padding: const EdgeInsets.symmetric(horizontal: DSSpacing.lg, vertical: DSSpacing.md),");
	lines.push("          minimumSize: const Size(64, 48),");
	lines.push(`          textStyle: ${btnTextStyle},`);
	lines.push("        ),");
	lines.push("      ),");
	lines.push("      outlinedButtonTheme: OutlinedButtonThemeData(");
	lines.push("        style: OutlinedButton.styleFrom(");
	if (hasElevation) lines.push("          elevation: DSElevation.none,");
	if (hasRadius) lines.push("          shape: RoundedRectangleBorder(borderRadius: DSRadius.mdAll),");
	lines.push("          side: BorderSide(color: scheme.outline),");
	if (hasSpacing) lines.push("          padding: const EdgeInsets.symmetric(horizontal: DSSpacing.lg, vertical: DSSpacing.md),");
	lines.push("          minimumSize: const Size(64, 48),");
	lines.push(`          textStyle: ${btnTextStyle},`);
	lines.push("        ),");
	lines.push("      ),");
	lines.push("      textButtonTheme: TextButtonThemeData(");
	lines.push("        style: TextButton.styleFrom(");
	if (hasRadius) lines.push("          shape: RoundedRectangleBorder(borderRadius: DSRadius.mdAll),");
	if (hasSpacing) lines.push("          padding: const EdgeInsets.symmetric(horizontal: DSSpacing.base, vertical: DSSpacing.md),");
	lines.push("          minimumSize: const Size(64, 48),");
	lines.push(`          textStyle: ${btnTextStyle},`);
	lines.push("        ),");
	lines.push("      ),");
	lines.push("      iconButtonTheme: IconButtonThemeData(");
	lines.push("        style: IconButton.styleFrom(");
	lines.push("          minimumSize: const Size(48, 48),");
	if (hasIconSize) lines.push("          iconSize: DSIconSize.md,");
	lines.push("        ),");
	lines.push("      ),");
	lines.push("");
	lines.push("      // FAB");
	lines.push("      floatingActionButtonTheme: FloatingActionButtonThemeData(");
	if (hasElevation) {
		lines.push("        elevation: DSElevation.lg,");
		lines.push("        highlightElevation: DSElevation.xl,");
	}
	lines.push("        backgroundColor: scheme.primaryContainer,");
	lines.push("        foregroundColor: scheme.onPrimaryContainer,");
	if (hasRadius) lines.push("        shape: RoundedRectangleBorder(borderRadius: DSRadius.lgAll),");
	lines.push("      ),");
	lines.push("");
	lines.push("      // Input");
	lines.push("      inputDecorationTheme: InputDecorationTheme(");
	lines.push("        filled: true,");
	lines.push("        fillColor: scheme.surfaceContainerHighest,");
	if (hasRadius) {
		lines.push("        border: OutlineInputBorder(borderRadius: DSRadius.mdAll, borderSide: BorderSide(color: scheme.outline)),");
		lines.push("        enabledBorder: OutlineInputBorder(borderRadius: DSRadius.mdAll, borderSide: BorderSide(color: scheme.outline)),");
		lines.push("        focusedBorder: OutlineInputBorder(borderRadius: DSRadius.mdAll, borderSide: BorderSide(color: scheme.primary, width: 2)),");
		lines.push("        errorBorder: OutlineInputBorder(borderRadius: DSRadius.mdAll, borderSide: BorderSide(color: scheme.error)),");
		lines.push("        focusedErrorBorder: OutlineInputBorder(borderRadius: DSRadius.mdAll, borderSide: BorderSide(color: scheme.error, width: 2)),");
	}
	if (hasSpacing) lines.push("        contentPadding: const EdgeInsets.symmetric(horizontal: DSSpacing.base, vertical: DSSpacing.md),");
	lines.push("      ),");
	lines.push("");
	lines.push("      // Chip");
	lines.push("      chipTheme: ChipThemeData(");
	if (hasElevation) lines.push("        elevation: DSElevation.none,");
	lines.push("        backgroundColor: scheme.surfaceContainerLow,");
	lines.push("        selectedColor: scheme.secondaryContainer,");
	if (hasRadius) lines.push("        shape: RoundedRectangleBorder(borderRadius: DSRadius.fullAll),");
	lines.push("        side: BorderSide(color: scheme.outlineVariant),");
	if (hasSpacing) lines.push("        padding: const EdgeInsets.symmetric(horizontal: DSSpacing.sm),");
	lines.push("      ),");
	lines.push("");
	lines.push("      // SnackBar");
	lines.push("      snackBarTheme: SnackBarThemeData(");
	lines.push("        backgroundColor: scheme.inverseSurface,");
	lines.push("        actionTextColor: scheme.inversePrimary,");
	if (hasElevation) lines.push("        elevation: DSElevation.lg,");
	if (hasRadius) lines.push("        shape: RoundedRectangleBorder(borderRadius: DSRadius.mdAll),");
	lines.push("        behavior: SnackBarBehavior.floating,");
	if (hasSpacing) lines.push("        insetPadding: const EdgeInsets.symmetric(horizontal: DSSpacing.base, vertical: DSSpacing.sm),");
	lines.push("      ),");
	lines.push("");
	lines.push("      // Tooltip");
	lines.push("      tooltipTheme: TooltipThemeData(");
	if (hasRadius) lines.push("        decoration: BoxDecoration(color: scheme.inverseSurface, borderRadius: DSRadius.mdAll),");
	if (hasSpacing) lines.push("        padding: const EdgeInsets.symmetric(horizontal: DSSpacing.sm, vertical: DSSpacing.xs),");
	lines.push("      ),");
	lines.push("");
	lines.push("      // PopupMenu");
	lines.push("      popupMenuTheme: PopupMenuThemeData(");
	if (hasElevation) lines.push("        elevation: DSElevation.xxl,");
	lines.push("        color: scheme.surfaceContainer,");
	if (hasRadius) lines.push("        shape: RoundedRectangleBorder(borderRadius: DSRadius.mdAll),");
	lines.push("        surfaceTintColor: scheme.surfaceTint,");
	lines.push("      ),");
	lines.push("");
	lines.push("      // NavigationBar");
	lines.push("      navigationBarTheme: NavigationBarThemeData(");
	if (hasElevation) lines.push("        elevation: DSElevation.md,");
	lines.push("        backgroundColor: scheme.surfaceContainer,");
	lines.push("        surfaceTintColor: scheme.surfaceTint,");
	lines.push("        indicatorColor: scheme.secondaryContainer,");
	if (hasRadius) lines.push("        indicatorShape: RoundedRectangleBorder(borderRadius: DSRadius.fullAll),");
	lines.push("        height: 80,");
	lines.push("        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,");
	lines.push("      ),");
	lines.push("");
	lines.push("      // TabBar");
	lines.push("      tabBarTheme: TabBarThemeData(");
	lines.push("        labelColor: scheme.primary,");
	lines.push("        unselectedLabelColor: scheme.onSurfaceVariant,");
	lines.push("        indicatorColor: scheme.primary,");
	lines.push("        indicatorSize: TabBarIndicatorSize.label,");
	lines.push(`        labelStyle: ${fontStyleExprNoColor(provider, uiFontFamily, {
		size: 14,
		weight: 600
	})},`);
	lines.push(`        unselectedLabelStyle: ${fontStyleExprNoColor(provider, uiFontFamily, {
		size: 14,
		weight: 400
	})},`);
	lines.push("      ),");
	lines.push("");
	lines.push("      // Divider");
	lines.push("      dividerTheme: DividerThemeData(color: scheme.outlineVariant, thickness: 1, space: 0),");
	lines.push("");
	lines.push("      // Progress");
	lines.push("      progressIndicatorTheme: ProgressIndicatorThemeData(");
	lines.push("        color: scheme.primary,");
	lines.push("        linearTrackColor: scheme.surfaceContainerHighest,");
	lines.push("        circularTrackColor: scheme.surfaceContainerHighest,");
	lines.push("      ),");
	lines.push("");
	lines.push("      // Switch");
	lines.push("      switchTheme: SwitchThemeData(");
	lines.push("        thumbColor: WidgetStateProperty.resolveWith((states) {");
	lines.push("          if (states.contains(WidgetState.selected)) return scheme.onPrimary;");
	lines.push("          return scheme.outline;");
	lines.push("        }),");
	lines.push("        trackColor: WidgetStateProperty.resolveWith((states) {");
	lines.push("          if (states.contains(WidgetState.selected)) return scheme.primary;");
	lines.push("          return scheme.surfaceContainerHighest;");
	lines.push("        }),");
	lines.push("        trackOutlineColor: WidgetStateProperty.resolveWith((states) {");
	lines.push("          if (states.contains(WidgetState.selected)) return Colors.transparent;");
	lines.push("          return scheme.outline;");
	lines.push("        }),");
	lines.push("      ),");
	lines.push("");
	lines.push("      // Checkbox");
	lines.push("      checkboxTheme: CheckboxThemeData(");
	lines.push("        fillColor: WidgetStateProperty.resolveWith((states) {");
	lines.push("          if (states.contains(WidgetState.selected)) return scheme.primary;");
	lines.push("          return Colors.transparent;");
	lines.push("        }),");
	lines.push("        checkColor: WidgetStateProperty.all(scheme.onPrimary),");
	lines.push("        side: BorderSide(color: scheme.onSurfaceVariant, width: 2),");
	if (hasRadius) lines.push("        shape: RoundedRectangleBorder(borderRadius: DSRadius.smAll),");
	lines.push("      ),");
	lines.push("");
	lines.push("      // Radio");
	lines.push("      radioTheme: RadioThemeData(");
	lines.push("        fillColor: WidgetStateProperty.resolveWith((states) {");
	lines.push("          if (states.contains(WidgetState.selected)) return scheme.primary;");
	lines.push("          return scheme.onSurfaceVariant;");
	lines.push("        }),");
	lines.push("      ),");
	lines.push("");
	lines.push("      // Slider");
	lines.push("      sliderTheme: SliderThemeData(");
	lines.push("        activeTrackColor: scheme.primary,");
	lines.push("        inactiveTrackColor: scheme.surfaceContainerHighest,");
	lines.push("        thumbColor: scheme.primary,");
	lines.push("        overlayColor: scheme.primary.withValues(alpha: 0.12),");
	lines.push("      ),");
	lines.push("");
	lines.push("      // ListTile");
	lines.push("      listTileTheme: ListTileThemeData(");
	if (hasSpacing) {
		lines.push("        contentPadding: const EdgeInsets.symmetric(horizontal: DSSpacing.base),");
		lines.push("        minVerticalPadding: DSSpacing.md,");
	}
	lines.push("        iconColor: scheme.onSurfaceVariant,");
	lines.push("        textColor: scheme.onSurface,");
	if (hasRadius) lines.push("        shape: RoundedRectangleBorder(borderRadius: DSRadius.mdAll),");
	lines.push("      ),");
	lines.push("");
	if (hasIconSize) {
		lines.push("      // Icon");
		lines.push("      iconTheme: IconThemeData(size: DSIconSize.md),");
		lines.push("");
	}
	lines.push("      // Scrollbar");
	lines.push("      scrollbarTheme: ScrollbarThemeData(");
	lines.push("        thumbColor: WidgetStateProperty.all(scheme.onSurface.withValues(alpha: 0.3)),");
	if (hasRadius) lines.push("        radius: const Radius.circular(DSRadius.full),");
	lines.push("        thickness: WidgetStateProperty.all(4),");
	lines.push("      ),");
	lines.push("");
	lines.push("      // Badge");
	lines.push("      badgeTheme: BadgeThemeData(");
	lines.push("        backgroundColor: scheme.error,");
	lines.push("        textColor: scheme.onError,");
	lines.push("      ),");
	lines.push("");
	lines.push("      // SearchBar");
	lines.push("      searchBarTheme: SearchBarThemeData(");
	if (hasElevation) lines.push("        elevation: WidgetStateProperty.all(DSElevation.sm),");
	lines.push("        backgroundColor: WidgetStateProperty.all(scheme.surfaceContainerHigh),");
	lines.push("        surfaceTintColor: WidgetStateProperty.all(scheme.surfaceTint),");
	if (hasRadius) lines.push("        shape: WidgetStateProperty.all(RoundedRectangleBorder(borderRadius: DSRadius.fullAll)),");
	if (hasSpacing) lines.push("        padding: WidgetStateProperty.all(const EdgeInsets.symmetric(horizontal: DSSpacing.base)),");
	lines.push("      ),");
	lines.push("");
	lines.push("      // BottomNavigationBar");
	lines.push("      bottomNavigationBarTheme: BottomNavigationBarThemeData(");
	lines.push("        backgroundColor: scheme.surfaceContainer,");
	lines.push("        selectedItemColor: scheme.primary,");
	lines.push("        unselectedItemColor: scheme.onSurfaceVariant,");
	if (hasElevation) lines.push("        elevation: DSElevation.md,");
	lines.push("        type: BottomNavigationBarType.fixed,");
	lines.push("      ),");
	lines.push("    );");
	lines.push("  }");
	lines.push("");
	lines.push("  static TextTheme _buildTextTheme(ColorScheme scheme) {");
	lines.push("    return TextTheme(");
	if (typo?.scale) for (const [key, entry] of Object.entries(typo.scale)) {
		const familyName = typo.fontFamily[entry.family] ?? entry.family;
		const weightValue = typo.fontWeight[entry.weight] ?? 400;
		const color = key === "bodySmall" || key === "labelSmall" ? "scheme.onSurfaceVariant" : "scheme.onSurface";
		const expr = fontStyleExpr(provider, familyName, {
			size: entry.size,
			weight: weightValue,
			color
		});
		lines.push(`      ${key}: ${expr},`);
	}
	lines.push("    );");
	lines.push("  }");
	lines.push("}");
	lines.push("");
	return lines.join("\n");
}
//#endregion
//#region src/plugins/builtin/ecosystem/dart/token-codegen.ts
const HEADER$1 = `// GENERATED — DO NOT EDIT. Changes will be overwritten.`;
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
		HEADER$1,
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
		HEADER$1,
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
function generateBarrel$1(fileNames) {
	const lines = [HEADER$1, ""];
	for (const name of fileNames) lines.push(`export '${name}';`);
	lines.push("");
	return lines.join("\n");
}
/**
* Generate the top-level package barrel file.
*/
function generatePackageBarrel(_packageName) {
	const lines = [HEADER$1, ""];
	lines.push("export 'core/theme/theme.dart';");
	lines.push("");
	return lines.join("\n");
}
//#endregion
//#region src/plugins/builtin/ecosystem/dart/asset-codegen.ts
const HEADER = "// GENERATED — DO NOT EDIT. Changes will be overwritten.";
/**
* Convert a category name to PascalCase for class naming.
* e.g., "map_pins" → "MapPins", "ui" → "Ui"
*/
function toPascalCase$2(str) {
	return str.split(/[_\-/]/).filter((part) => part.length > 0).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}
/**
* Convert a key to a valid Dart identifier (camelCase).
* e.g., "first_walk" → "firstWalk", "wren-head" → "wrenHead"
* Keys starting with a digit get a `$` prefix.
*/
function toCamelCase$1(str) {
	const parts = str.split(/[_\-]/).filter((p) => p.length > 0);
	if (parts.length === 0) return str;
	const result = (parts[0] ?? "") + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
	if (/^\d/.test(result)) return `\$${result}`;
	return result;
}
/**
* Generate a prefixed class name from workspace name.
* Splits on delimiters or camelCase boundaries.
* e.g., "nextsaga" → "Ns", "my-app" → "Ma", "coolProject" → "Cp"
*/
function derivePrefix(workspaceName) {
	const explicitParts = workspaceName.split(/[_\-.\s]+/);
	if (explicitParts.length >= 2) return explicitParts.map((p) => p.charAt(0).toUpperCase()).join("");
	const camelParts = workspaceName.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
	if (camelParts.length >= 2) return camelParts.map((p) => p.charAt(0).toUpperCase()).join("");
	const word = workspaceName.toLowerCase();
	if (word.length >= 6) {
		const mid = Math.floor(word.length / 2);
		return word.charAt(0).toUpperCase() + word.charAt(mid).toUpperCase();
	}
	return word.charAt(0).toUpperCase() + (word.charAt(1) ?? "").toUpperCase();
}
/**
* Generate a typed Dart widget class for a category of SVG icons.
*/
function generateCategoryClass(category, prefix, packageName) {
	const svgEntries = category.entries.filter((e) => e.ext === "svg");
	if (svgEntries.length === 0) return null;
	const className = `${prefix}${toPascalCase$2(category.name)}Icon`;
	const lines = [];
	lines.push(`abstract final class ${className} {`);
	for (const entry of svgEntries) {
		const methodName = toCamelCase$1(entry.key);
		lines.push(`  static Widget ${methodName}({double? size, Color? color}) =>`);
		lines.push("    SvgPicture.asset(");
		lines.push(`      'assets/${entry.relativePath}',`);
		lines.push(`      package: '${packageName}',`);
		lines.push("      width: size,");
		lines.push("      height: size,");
		lines.push("      colorFilter: color != null");
		lines.push("        ? ColorFilter.mode(color, BlendMode.srcIn)");
		lines.push("        : null,");
		lines.push("    );");
		lines.push("");
	}
	const firstEntry = svgEntries[0];
	if (firstEntry && svgEntries.length > 1) {
		const dir = firstEntry.relativePath.split("/").slice(0, -1).join("/");
		const hasCommonDir = svgEntries.every((e) => e.relativePath.startsWith(dir + "/"));
		const usesPrefix = svgEntries.every((e) => e.name.startsWith(`${category.name}_`));
		if (hasCommonDir && usesPrefix) {
			lines.push(`  /// Dynamic accessor — loads by key from the ${category.name} directory.`);
			lines.push("  static Widget byKey(String key, {double? size, Color? color}) =>");
			lines.push("    SvgPicture.asset(");
			lines.push(`      'assets/${dir}/${category.name}_\$key.svg',`);
			lines.push(`      package: '${packageName}',`);
			lines.push("      width: size,");
			lines.push("      height: size,");
			lines.push("      colorFilter: color != null");
			lines.push("        ? ColorFilter.mode(color, BlendMode.srcIn)");
			lines.push("        : null,");
			lines.push("    );");
		}
	}
	lines.push("}");
	return lines.join("\n");
}
/** Raster image extensions */
const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"webp",
	"gif"
]);
/**
* Generate a typed Dart class for a category of raster images.
* Returns Image.asset widgets instead of SvgPicture.
*/
function generateImageClass(category, prefix, packageName) {
	const imageEntries = category.entries.filter((e) => IMAGE_EXTENSIONS.has(e.ext));
	if (imageEntries.length === 0) return null;
	const className = `${prefix}${toPascalCase$2(category.name)}Image`;
	const lines = [];
	lines.push(`abstract final class ${className} {`);
	for (const entry of imageEntries) {
		const methodName = toCamelCase$1(entry.key);
		lines.push(`  static Widget ${methodName}({double? width, double? height, BoxFit? fit}) =>`);
		lines.push("    Image.asset(");
		lines.push(`      'assets/${entry.relativePath}',`);
		lines.push(`      package: '${packageName}',`);
		lines.push("      width: width,");
		lines.push("      height: height,");
		lines.push("      fit: fit ?? BoxFit.contain,");
		lines.push("    );");
		lines.push("");
	}
	lines.push("}");
	return lines.join("\n");
}
/**
* Generate theme-aware icon classes for variant groups (light/dark).
*/
function generateThemeVariantClass(variant, prefix, packageName) {
	const className = `${prefix}${toPascalCase$2(variant.category)}Icon`;
	const lines = [];
	lines.push(`abstract final class ${className} {`);
	const allKeys = /* @__PURE__ */ new Set();
	for (const [, entries] of variant.variants) for (const entry of entries) allKeys.add(entry.key);
	const sortedKeys = [...allKeys].sort();
	for (const key of sortedKeys) {
		const methodName = toCamelCase$1(key);
		lines.push(`  static Widget ${methodName}({required bool isDark, double? size, Color? color}) {`);
		lines.push("    final variant = isDark ? 'dark' : 'light';");
		const entry = [...variant.variants.values()][0]?.find((e) => e.key === key);
		if (entry) {
			const pathParts = entry.relativePath.split("/");
			const variantIdx = pathParts.findIndex((p) => p === "light" || p === "dark");
			if (variantIdx >= 0) {
				pathParts[variantIdx] = "$variant";
				const templatePath = pathParts.join("/");
				lines.push("    return SvgPicture.asset(");
				lines.push(`      'assets/${templatePath}',`);
				lines.push(`      package: '${packageName}',`);
				lines.push("      width: size,");
				lines.push("      height: size,");
				lines.push("      colorFilter: color != null");
				lines.push("        ? ColorFilter.mode(color, BlendMode.srcIn)");
				lines.push("        : null,");
				lines.push("    );");
			}
		}
		lines.push("  }");
		lines.push("");
	}
	lines.push("}");
	return lines.join("\n");
}
/**
* Generate the pubspec.yaml for the generated Dart assets package.
*/
function generatePubspec(packageName, assetDirs) {
	const lines = [
		"# GENERATED — DO NOT EDIT. Changes will be overwritten.",
		`name: ${packageName}`,
		`description: Generated asset package for ${packageName}`,
		"version: 0.0.0",
		"publish_to: none",
		"",
		"environment:",
		"  sdk: '>=3.0.0 <4.0.0'",
		"  flutter: '>=3.10.0'",
		"",
		"dependencies:",
		"  flutter:",
		"    sdk: flutter",
		"  flutter_svg: ^2.0.0",
		"",
		"flutter:",
		"  assets:"
	];
	for (const dir of assetDirs) {
		const normalized = dir.endsWith("/") ? dir : `${dir}/`;
		lines.push(`    - assets/${normalized}`);
	}
	lines.push("");
	return lines.join("\n");
}
/**
* Generate the package barrel file.
*/
function generateBarrel(fileNames) {
	const lines = [HEADER, ""];
	for (const name of fileNames) lines.push(`export '${name}';`);
	lines.push("");
	return lines.join("\n");
}
/**
* Narrow unknown domainData to AssetManifest.
*/
function isAssetManifest(value) {
	if (!isRecord(value)) return false;
	return typeof value["workspaceName"] === "string" && Array.isArray(value["categories"]) && Array.isArray(value["allEntries"]);
}
/**
* Execute Dart asset codegen — generates typed Flutter widget classes
* and copies raw asset files into the generated package.
*/
async function executeDartAssetGeneration(_pkg, root, context) {
	const start = performance.now();
	if (!isAssetManifest(context.domainData)) return {
		success: false,
		duration: 0,
		summary: "No asset manifest provided — assets plugin must scan first"
	};
	const manifest = context.domainData;
	const outDir = context.outputDir;
	if (!outDir) return {
		success: false,
		duration: 0,
		summary: "No outputDir provided"
	};
	const prefix = derivePrefix(manifest.workspaceName);
	const rawSource = (context.sourceName ?? "assets").replace(/^@[^/]+\//, "");
	const packageName = `${manifest.workspaceName}_${rawSource}`;
	const libDir = join(outDir, "lib");
	mkdirSync(libDir, { recursive: true });
	const sourcePath = context.artifactPath;
	if (sourcePath) {
		const sourceDir = join(root, sourcePath);
		const destAssetsDir = join(outDir, "assets");
		if (existsSync(sourceDir)) {
			mkdirSync(destAssetsDir, { recursive: true });
			const sourceSubDirs = new Set(manifest.assetDirectories.map((d) => d.split("/")[0] ?? ""));
			for (const dir of sourceSubDirs) {
				if (!dir) continue;
				const srcSubDir = join(sourceDir, dir);
				if (existsSync(srcSubDir)) cpSync(srcSubDir, join(destAssetsDir, dir), { recursive: true });
			}
		}
	}
	const generatedFiles = [];
	const themedEntryPaths = /* @__PURE__ */ new Set();
	for (const variant of manifest.themeVariants) for (const [, entries] of variant.variants) for (const entry of entries) themedEntryPaths.add(entry.relativePath);
	const regularCategories = manifest.categories.map((cat) => ({
		...cat,
		entries: cat.entries.filter((e) => !themedEntryPaths.has(e.relativePath))
	})).filter((cat) => cat.entries.length > 0);
	const regularClasses = [];
	for (const category of regularCategories) {
		const classCode = generateCategoryClass(category, prefix, packageName);
		if (classCode) regularClasses.push(classCode);
	}
	if (regularClasses.length > 0) {
		const classLines = [HEADER, ""];
		classLines.push("import 'package:flutter/material.dart';");
		classLines.push("import 'package:flutter_svg/flutter_svg.dart';");
		classLines.push("");
		classLines.push(regularClasses.join("\n\n"));
		classLines.push("");
		const fileName = "icons.generated.dart";
		writeFileSync(join(libDir, fileName), classLines.join("\n"), "utf-8");
		generatedFiles.push(fileName);
	}
	const imageClasses = [];
	for (const category of regularCategories) {
		const classCode = generateImageClass(category, prefix, packageName);
		if (classCode) imageClasses.push(classCode);
	}
	if (imageClasses.length > 0) {
		const classLines = [HEADER, ""];
		classLines.push("import 'package:flutter/material.dart';");
		classLines.push("");
		classLines.push(imageClasses.join("\n\n"));
		classLines.push("");
		const fileName = "images.generated.dart";
		writeFileSync(join(libDir, fileName), classLines.join("\n"), "utf-8");
		generatedFiles.push(fileName);
	}
	if (manifest.themeVariants.length > 0) {
		const classLines = [HEADER, ""];
		classLines.push("import 'package:flutter/material.dart';");
		classLines.push("import 'package:flutter_svg/flutter_svg.dart';");
		classLines.push("");
		for (const variant of manifest.themeVariants) {
			classLines.push(generateThemeVariantClass(variant, prefix, packageName));
			classLines.push("");
		}
		const fileName = "themed_icons.generated.dart";
		writeFileSync(join(libDir, fileName), classLines.join("\n"), "utf-8");
		generatedFiles.push(fileName);
	}
	const pubspec = generatePubspec(packageName, manifest.assetDirectories);
	writeFileSync(join(outDir, "pubspec.yaml"), pubspec, "utf-8");
	if (generatedFiles.length > 0) {
		const barrel = generateBarrel(generatedFiles);
		writeFileSync(join(libDir, `${packageName}.dart`), barrel, "utf-8");
	}
	const pubGetResult = await runCommand("dart", ["pub", "get"], outDir);
	if (!pubGetResult.success) return {
		success: false,
		duration: Math.round(performance.now() - start),
		summary: "dart pub get failed in generated icons package",
		output: pubGetResult.output
	};
	return {
		success: true,
		duration: Math.round(performance.now() - start),
		summary: `${generatedFiles.length} file(s) + pubspec.yaml + ${manifest.allEntries.length} assets copied`
	};
}
//#endregion
//#region src/plugins/builtin/ecosystem/dart/openapi-codegen.ts
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
//#region src/plugins/builtin/ecosystem/dart/plugin.ts
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
const ACTION_GENERATE_ASSETS = "generate-assets";
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
	scaffoldDartPackage(outRoot, packageName, tokens);
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
	const barrelContent = generateBarrel$1(generatedFiles);
	writeFileSync(join(generatedDir, "generated.dart"), barrelContent, "utf-8");
	writeFileSync(join(themeDir, "theme.dart"), themeContent, "utf-8");
	mkdirSync(join(outRoot, "lib"), { recursive: true });
	const packageBarrelContent = generatePackageBarrel(packageName);
	writeFileSync(join(outRoot, "lib", `${packageName}.dart`), packageBarrelContent, "utf-8");
	const pubGetResult = await runCommand("dart", ["pub", "get"], outRoot);
	if (!pubGetResult.success) return {
		success: false,
		duration: Math.round(performance.now() - start),
		summary: `dart pub get failed in generated package`,
		output: pubGetResult.output
	};
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
			case ACTION_GENERATE_ASSETS: return executeDartAssetGeneration(pkg, root, context);
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
		if (domain === "assets") return {
			action: ACTION_GENERATE_ASSETS,
			description: "Flutter typed asset wrappers + pubspec declarations"
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
//#region src/plugins/builtin/domain/assets/scanner.ts
/** File extensions recognized as assets */
const ASSET_EXTENSIONS = new Set([
	"svg",
	"png",
	"jpg",
	"jpeg",
	"webp",
	"gif"
]);
/** Directory names that indicate theme variants */
const THEME_VARIANT_DIRS = new Set(["light", "dark"]);
/** Directories to skip when scanning (generated output, hidden dirs) */
const IGNORED_DIRS = new Set([
	"generated",
	"node_modules",
	".dart_tool"
]);
/**
* Infer category and key from a filename.
*
* Convention: `{category}_{key}.ext` — e.g., `achievement_first_walk.svg`.
* If no underscore prefix matches, the entire basename is the key and
* the parent directory name is used as the category.
*/
function inferCategoryAndKey(name, parentDir) {
	const underscoreIdx = name.indexOf("_");
	if (underscoreIdx > 0) return {
		category: name.slice(0, underscoreIdx),
		key: name.slice(underscoreIdx + 1)
	};
	return {
		category: parentDir || "misc",
		key: name
	};
}
/**
* Recursively scan a directory for asset files.
*/
function scanDir(absDir, assetsRoot, parentDir) {
	const entries = [];
	let dirEntries;
	try {
		dirEntries = readdirSync(absDir);
	} catch {
		return entries;
	}
	for (const entry of dirEntries) {
		const absPath = join(absDir, entry);
		const stat = statSync(absPath, { throwIfNoEntry: false });
		if (!stat) continue;
		if (stat.isDirectory()) {
			if (IGNORED_DIRS.has(entry) || entry.startsWith(".")) continue;
			entries.push(...scanDir(absPath, assetsRoot, entry));
			continue;
		}
		if (!stat.isFile()) continue;
		const ext = extname(entry).slice(1).toLowerCase();
		if (!ASSET_EXTENSIONS.has(ext)) continue;
		const nameWithoutExt = entry.slice(0, -(ext.length + 1));
		const relativePath = relative(assetsRoot, absPath);
		const { category, key } = inferCategoryAndKey(nameWithoutExt, parentDir);
		entries.push({
			name: nameWithoutExt,
			ext,
			relativePath,
			category,
			key
		});
	}
	return entries;
}
/**
* Detect theme variants in directories that contain light/dark subdirectories.
*/
function detectThemeVariants(allEntries) {
	const variantMap = /* @__PURE__ */ new Map();
	for (const entry of allEntries) {
		const parts = entry.relativePath.split("/");
		const variantName = parts.find((p) => THEME_VARIANT_DIRS.has(p));
		if (!variantName) continue;
		const variantIdx = parts.indexOf(variantName);
		const groupKey = parts.slice(0, variantIdx).join("/") || entry.category;
		let group = variantMap.get(groupKey);
		if (!group) {
			group = /* @__PURE__ */ new Map();
			variantMap.set(groupKey, group);
		}
		let variantEntries = group.get(variantName);
		if (!variantEntries) {
			variantEntries = [];
			group.set(variantName, variantEntries);
		}
		variantEntries.push(entry);
	}
	const variants = [];
	for (const [category, group] of variantMap) variants.push({
		category,
		variants: group
	});
	return variants;
}
/**
* Collect unique top-level asset directories for pubspec declarations.
*/
function collectAssetDirectories(allEntries) {
	const dirs = /* @__PURE__ */ new Set();
	for (const entry of allEntries) {
		const parts = entry.relativePath.split("/");
		if (parts.length > 1) {
			const dir = parts.slice(0, -1).join("/") + "/";
			dirs.add(dir);
		}
	}
	return [...dirs].sort();
}
/**
* Group entries by category.
*/
function groupByCategory(entries) {
	const map = /* @__PURE__ */ new Map();
	for (const entry of entries) {
		let group = map.get(entry.category);
		if (!group) {
			group = [];
			map.set(entry.category, group);
		}
		group.push(entry);
	}
	const categories = [];
	for (const [name, catEntries] of map) categories.push({
		name,
		entries: catEntries
	});
	return categories.sort((a, b) => a.name.localeCompare(b.name));
}
/**
* Scan an assets package directory and produce a manifest.
*
* Looks for asset files in subdirectories (svg/, images/, map/, etc.).
* Infers categories from filename prefixes.
* Detects theme variants from light/dark subdirectories.
*/
function scanAssets(assetsRoot, workspaceName) {
	const allEntries = scanDir(assetsRoot, assetsRoot, "");
	return {
		workspaceName,
		categories: groupByCategory(allEntries),
		themeVariants: detectThemeVariants(allEntries),
		allEntries,
		assetDirectories: collectAssetDirectories(allEntries)
	};
}
//#endregion
//#region src/plugins/builtin/domain/assets/plugin.ts
const DOMAIN_NAME$1 = "assets";
/**
* Well-known directory names that indicate an assets package.
* If the artifact path points to a directory containing any of these,
* the plugin claims the bridge.
*/
const ASSET_DIRECTORY_MARKERS = [
	"svg",
	"icons",
	"images",
	"assets"
];
/**
* Check if a directory looks like an assets package.
* Requires at least one well-known asset subdirectory.
*/
function looksLikeAssetsPackage(absPath) {
	for (const marker of ASSET_DIRECTORY_MARKERS) if (existsSync(join(absPath, marker))) return true;
	return false;
}
const assetsPlugin = {
	type: "domain",
	name: "assets",
	async detectBridge(artifact, root) {
		const absPath = join(root, artifact);
		if (existsSync(absPath) && looksLikeAssetsPackage(absPath)) return true;
		if (artifact.split(".").pop()?.toLowerCase() === "json") return looksLikeAssetsPackage(join(root, artifact.split("/").slice(0, -1).join("/")));
		return false;
	},
	async exportArtifact(source, _artifact, root) {
		const start = performance.now();
		if (!looksLikeAssetsPackage(join(root, source.path))) return {
			success: false,
			duration: Math.round(performance.now() - start),
			summary: `No asset directories found in ${source.path}`
		};
		return {
			success: true,
			duration: Math.round(performance.now() - start),
			summary: "assets detected"
		};
	},
	async generateDownstream(artifact, targets, root, context) {
		const sourcePath = artifact;
		const manifest = scanAssets(join(root, sourcePath), context.graph.name);
		if (manifest.allEntries.length === 0) return [{
			success: false,
			duration: 0,
			summary: "No assets found to generate from"
		}];
		const handlers = await context.findEcosystemHandlers(DOMAIN_NAME$1, artifact);
		const targetPaths = new Set(targets.map((t) => t.path));
		const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));
		if (relevantHandlers.length === 0) return [];
		const sourceName = context.graph.packages.get(sourcePath)?.name ?? sourcePath.split("/").pop() ?? "assets";
		const results = [];
		for (const handler of relevantHandlers) {
			const outputDir = join(root, sourcePath, "generated", handler.plugin.name);
			mkdirSync(outputDir, { recursive: true });
			const ctxWithAssets = {
				...context,
				sourceName,
				artifactPath: artifact,
				domainData: manifest,
				outputDir
			};
			const result = await handler.plugin.execute(handler.capability.action, handler.pkg, root, ctxWithAssets);
			results.push(result);
		}
		return results;
	},
	async buildPipeline(source, artifact, targets, root, context) {
		const steps = [];
		const shared = { manifest: void 0 };
		steps.push({
			name: "scan-assets",
			plugin: "assets",
			description: "scanning assets...",
			outputPaths: [artifact],
			execute: async () => {
				const start = performance.now();
				const sourceDir = join(root, source.path);
				try {
					shared.manifest = scanAssets(sourceDir, context.graph.name);
					const count = shared.manifest.allEntries.length;
					const catCount = shared.manifest.categories.length;
					return {
						success: true,
						duration: Math.round(performance.now() - start),
						summary: `${count} assets in ${catCount} categories`
					};
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return {
						success: false,
						duration: Math.round(performance.now() - start),
						summary: `Failed to scan assets: ${msg}`
					};
				}
			}
		});
		const handlers = await context.findEcosystemHandlers(DOMAIN_NAME$1, artifact);
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
				description: `generating ${handler.plugin.name} asset wrappers...`,
				execute: async () => {
					if (!shared.manifest) return {
						success: false,
						duration: 0,
						summary: "Cannot generate — asset scan did not run"
					};
					mkdirSync(outputDir, { recursive: true });
					const ctxWithAssets = {
						...context,
						sourceName: source.name,
						artifactPath: artifact,
						domainData: shared.manifest,
						outputDir
					};
					return handler.plugin.execute(handler.capability.action, handler.pkg, root, ctxWithAssets);
				}
			});
		}
		return steps;
	}
};
//#endregion
//#region src/plugins/builtin/domain/design/token-schema.ts
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
function toPascalCase$1(key) {
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
	let className = toPascalCase$1(key);
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
//#region src/plugins/builtin/domain/design/plugin.ts
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
//#region src/plugins/builtin/domain/openapi/server-boot.ts
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
//#region src/plugins/builtin/domain/openapi/exporter.ts
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
	const { detectAdapter } = await import("./adapters-CZH6yJ21.js");
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
//#region src/plugins/builtin/domain/openapi/normalizer.ts
function isJsonObject(val) {
	return val !== null && typeof val === "object" && !Array.isArray(val);
}
const SUPPORTED_METHODS = new Set([
	"get",
	"post",
	"put",
	"patch",
	"delete"
]);
function capitalize(s) {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
function toPascalCase(s) {
	return s.replace(/-/g, "_").split("_").map((p) => capitalize(p)).join("");
}
/**
* Generate a schema name from an API path and method.
* Strips version prefixes (e.g., /v1/, /v2/) for cleaner names.
*/
function schemaNameFromPath(path, method, statusCode, registeredNames) {
	const base = path.replace(/^\/v\d+\//, "").split("/").filter((p) => !p.startsWith("{")).map((p) => toPascalCase(p)).join("");
	const methodPrefix = capitalize(method);
	const code = Number(statusCode);
	return registerName(`${methodPrefix}${base}${code >= 200 && code < 300 ? "Response" : `Error${statusCode}`}`, registeredNames);
}
function registerName(name, registeredNames) {
	if (!registeredNames.has(name)) {
		registeredNames.add(name);
		return name;
	}
	let i = 2;
	while (registeredNames.has(`${name}${i}`)) i++;
	const unique = `${name}${i}`;
	registeredNames.add(unique);
	return unique;
}
/**
* Recursively convert tuple-style `items` arrays to `items: { type: 'number' }`.
* OpenAPI 3.0 tuples use `items: [schema, schema]` but many codegen tools
* expect `items: { ... }` (a single schema object).
*/
function fixTupleItems(obj) {
	if (Array.isArray(obj)) {
		for (const item of obj) fixTupleItems(item);
		return;
	}
	if (!isJsonObject(obj)) return;
	if (obj["type"] === "array" && Array.isArray(obj["items"])) obj["items"] = { type: "number" };
	for (const value of Object.values(obj)) fixTupleItems(value);
}
/**
* Recursively extract inline object schemas from a schema and register them
* as named components. Replaces inline objects with $ref pointers.
*/
function extractNestedSchemas(schema, parentName, components, registeredNames) {
	const properties = schema["properties"];
	if (!isJsonObject(properties)) return;
	for (const [propName, propSchema] of Object.entries(properties)) {
		if (!isJsonObject(propSchema)) continue;
		if (Array.isArray(propSchema["enum"]) && propSchema["enum"].length > 1) {
			const enumName = registerName(`${parentName}${toPascalCase(propName)}`, registeredNames);
			components[enumName] = propSchema;
			properties[propName] = { $ref: `#/components/schemas/${enumName}` };
			continue;
		}
		if (propSchema["type"] === "object" && propSchema["properties"]) {
			const childName = registerName(`${parentName}${toPascalCase(propName)}`, registeredNames);
			extractNestedSchemas(propSchema, childName, components, registeredNames);
			components[childName] = propSchema;
			properties[propName] = { $ref: `#/components/schemas/${childName}` };
		}
		if (propSchema["type"] === "array") {
			const items = propSchema["items"];
			if (isJsonObject(items) && items["type"] === "object" && items["properties"]) {
				const childName = registerName(`${parentName}${toPascalCase(propName)}Item`, registeredNames);
				extractNestedSchemas(items, childName, components, registeredNames);
				components[childName] = items;
				propSchema["items"] = { $ref: `#/components/schemas/${childName}` };
			}
		}
		const anyOf = propSchema["anyOf"] ?? propSchema["oneOf"];
		if (Array.isArray(anyOf)) for (let i = 0; i < anyOf.length; i++) {
			const variant = anyOf[i];
			if (isJsonObject(variant) && variant["type"] === "object" && variant["properties"]) {
				const childName = registerName(`${parentName}${toPascalCase(propName)}Variant${i}`, registeredNames);
				extractNestedSchemas(variant, childName, components, registeredNames);
				components[childName] = variant;
				anyOf[i] = { $ref: `#/components/schemas/${childName}` };
			}
		}
	}
}
const EMPTY_JSON_RESPONSE = { "application/json": { schema: {
	type: "object",
	properties: {}
} } };
const API_ERROR_SCHEMA = {
	type: "object",
	required: ["code", "message"],
	properties: {
		code: { type: "string" },
		message: { type: "string" }
	}
};
const API_ERROR_REF = "#/components/schemas/ApiError";
function isApiErrorSchema(schema) {
	const props = schema["properties"];
	if (!isJsonObject(props)) return false;
	const keys = Object.keys(props);
	if (keys.length !== 2 || !keys.includes("code") || !keys.includes("message")) return false;
	const code = props["code"];
	const message = props["message"];
	return isJsonObject(code) && code["type"] === "string" && isJsonObject(message) && message["type"] === "string";
}
function ensureResponseContent(response) {
	if (!response["content"]) response["content"] = { ...EMPTY_JSON_RESPONSE };
}
function extractResponseSchema(response, path, method, statusCode, components, registeredNames) {
	const content = response["content"];
	if (!isJsonObject(content)) return;
	const jsonContent = content["application/json"];
	if (!isJsonObject(jsonContent)) return;
	const schema = jsonContent["schema"];
	if (!isJsonObject(schema) || "$ref" in schema) return;
	if (isApiErrorSchema(schema)) {
		jsonContent["schema"] = { $ref: API_ERROR_REF };
		return;
	}
	const name = schemaNameFromPath(path, method, statusCode, registeredNames);
	extractNestedSchemas(schema, name, components, registeredNames);
	components[name] = schema;
	jsonContent["schema"] = { $ref: `#/components/schemas/${name}` };
}
function extractRequestBodySchema(detail, path, method, components, registeredNames) {
	const requestBody = detail["requestBody"];
	if (!isJsonObject(requestBody)) return;
	const content = requestBody["content"];
	if (!isJsonObject(content)) return;
	for (const [, mediaType] of Object.entries(content)) {
		if (!isJsonObject(mediaType)) continue;
		const schema = mediaType["schema"];
		if (!isJsonObject(schema) || "$ref" in schema) continue;
		const base = path.replace(/^\/v\d+\//, "").split("/").filter((p) => !p.startsWith("{")).map((p) => toPascalCase(p)).join("");
		const name = registerName(`${capitalize(method)}${base}Body`, registeredNames);
		extractNestedSchemas(schema, name, components, registeredNames);
		components[name] = schema;
		mediaType["schema"] = { $ref: `#/components/schemas/${name}` };
		for (const otherCt of Object.keys(content)) if (otherCt !== "application/json") delete content[otherCt];
		break;
	}
}
function extractParameterEnums(detail, path, components, registeredNames) {
	const parameters = detail["parameters"];
	if (!Array.isArray(parameters)) return;
	for (const param of parameters) {
		if (!isJsonObject(param)) continue;
		const paramSchema = param["schema"];
		if (isJsonObject(paramSchema) && Array.isArray(paramSchema["enum"]) && paramSchema["enum"].length > 1 && typeof param["name"] === "string") {
			const enumName = registerName(`${path.replace(/^\/v\d+\//, "").split("/").filter((p) => !p.startsWith("{")).map((p) => toPascalCase(p)).join("")}${toPascalCase(param["name"])}`, registeredNames);
			components[enumName] = paramSchema;
			param["schema"] = { $ref: `#/components/schemas/${enumName}` };
		}
	}
}
/**
* Normalize an OpenAPI spec for downstream code generation.
*
* Performs:
* - Remove wildcard paths and unsupported HTTP methods
* - Remove paths matching exclude prefixes
* - Fix tuple-style array items
* - Extract inline schemas into named $ref components
* - Deduplicate common API error schemas
* - Ensure all responses have content blocks
* - Extract request body and parameter enum schemas
*
* Reads from `inputPath`, writes normalized spec to `outputPath`.
* Returns the number of schemas extracted and paths removed.
*/
function normalizeSpec(inputPath, outputPath, options = {}) {
	const raw = JSON.parse(readFileSync(inputPath, "utf-8"));
	if (!isJsonObject(raw) || !isJsonObject(raw["paths"])) {
		writeFileSync(outputPath, JSON.stringify(raw, null, 2), "utf-8");
		return {
			schemaCount: 0,
			removedCount: 0
		};
	}
	const spec = raw;
	const paths = spec["paths"];
	const excludePrefixes = options.excludePrefixes ?? [];
	if (!isJsonObject(spec["components"])) spec["components"] = { schemas: {} };
	const components = spec["components"];
	if (!isJsonObject(components["schemas"])) components["schemas"] = {};
	const schemas = components["schemas"];
	const registeredNames = /* @__PURE__ */ new Set();
	for (const name of Object.keys(schemas)) registeredNames.add(name);
	fixTupleItems(spec);
	schemas["ApiError"] = API_ERROR_SCHEMA;
	registeredNames.add("ApiError");
	const pathsToRemove = [];
	for (const [path, methods] of Object.entries(paths)) {
		if (path.includes("*")) {
			pathsToRemove.push(path);
			continue;
		}
		if (excludePrefixes.some((prefix) => path.startsWith(prefix))) {
			pathsToRemove.push(path);
			continue;
		}
		if (!isJsonObject(methods)) continue;
		const methodsToRemove = [];
		for (const [method, detail] of Object.entries(methods)) {
			if (!SUPPORTED_METHODS.has(method)) {
				methodsToRemove.push(method);
				continue;
			}
			if (!isJsonObject(detail)) continue;
			const responses = detail["responses"];
			if (!isJsonObject(responses)) {
				detail["responses"] = { "200": {
					description: "Success",
					content: { ...EMPTY_JSON_RESPONSE }
				} };
				continue;
			}
			for (const [statusCode, response] of Object.entries(responses)) {
				if (!isJsonObject(response)) {
					responses[statusCode] = {
						description: `Response for status ${statusCode}`,
						content: { ...EMPTY_JSON_RESPONSE }
					};
					continue;
				}
				ensureResponseContent(response);
				extractResponseSchema(response, path, method, statusCode, schemas, registeredNames);
			}
			extractRequestBodySchema(detail, path, method, schemas, registeredNames);
			extractParameterEnums(detail, path, schemas, registeredNames);
		}
		for (const m of methodsToRemove) delete methods[m];
	}
	for (const p of pathsToRemove) delete paths[p];
	writeFileSync(outputPath, JSON.stringify(spec, null, 2), "utf-8");
	return {
		schemaCount: Object.keys(schemas).length,
		removedCount: pathsToRemove.length
	};
}
//#endregion
//#region src/plugins/builtin/domain/openapi/plugin.ts
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
		const preparedArtifact = `${base}.prepared${ext}`;
		const bridge = context.graph.bridges.find((b) => b.source === source.path && b.artifact === artifact);
		steps.push({
			name: "prepare-spec",
			plugin: "openapi",
			description: "normalizing spec...",
			outputPaths: [preparedArtifact],
			execute: async () => {
				const start = performance.now();
				try {
					const { schemaCount, removedCount } = normalizeSpec(join(root, artifact), join(root, preparedArtifact), { excludePrefixes: bridge?.exclude });
					return {
						success: true,
						duration: Math.round(performance.now() - start),
						summary: `${schemaCount} schemas, ${removedCount} paths removed`
					};
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return {
						success: false,
						duration: Math.round(performance.now() - start),
						summary: `Normalization failed: ${msg}`
					};
				}
			}
		});
		const downstreamArtifact = preparedArtifact;
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
		domain: [
			designPlugin,
			openapiPlugin,
			assetsPlugin
		]
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
			dryRun: options?.dryRun,
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

//# sourceMappingURL=registry-DCOcR5jv.js.map