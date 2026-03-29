#!/usr/bin/env node
import { r as isRecord } from "./version-M9xRTj7S.js";
import { a as GREEN, r as DIM, s as ORANGE, t as BOLD, u as RESET } from "./output-MbJ98jNX.js";
import { t as printBanner } from "./bin.js";
import { t as loadConfig } from "./loader-FFG_yaOW.js";
import { n as loadPlugins, t as PluginRegistry } from "./registry-Ddl2lw0X.js";
import { n as runCheck } from "./check-BUBkRpbN.js";
import { readFile, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Document, isMap, isScalar } from "yaml";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { cancel, confirm, intro, isCancel, log, multiselect, note, outro, path, select, spinner, text } from "@clack/prompts";
import { spawnSync } from "node:child_process";
//#region src/discovery/scanner.ts
/** Directories to always skip during scanning */
const SKIP_DIRS = new Set([
	".dart_tool",
	".git",
	".husky",
	".idea",
	".mido",
	".symlinks",
	".vscode",
	"android",
	"build",
	"dist",
	"example",
	"generated",
	"ios",
	"linux",
	"macos",
	"node_modules",
	"web",
	"windows"
]);
/** Manifest filenames and their ecosystem names */
const MANIFEST_MAP = new Map([
	["package.json", "typescript"],
	["pubspec.yaml", "dart"],
	["Cargo.toml", "rust"],
	["pyproject.toml", "python"]
]);
/** Ecosystems that mido currently supports */
const SUPPORTED_ECOSYSTEMS = new Set(["typescript", "dart"]);
/**
* Load .gitignore patterns from root. Returns a simple set of directory names
* to skip (not full glob support — just top-level directory names).
*/
function loadGitignoreDirs(root) {
	const gitignorePath = join(root, ".gitignore");
	const dirs = /* @__PURE__ */ new Set();
	if (!existsSync(gitignorePath)) return dirs;
	try {
		const content = readFileSync(gitignorePath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const cleaned = trimmed.replace(/\/$/, "");
			if (cleaned && !cleaned.includes("*") && !cleaned.includes("/")) dirs.add(cleaned);
		}
	} catch {}
	return dirs;
}
/**
* Scan a repository root for ecosystem markers.
* Returns all discovered packages (both supported and unsupported).
*/
function scanRepo(root) {
	const gitignoreDirs = loadGitignoreDirs(root);
	const skipAll = new Set([...SKIP_DIRS, ...gitignoreDirs]);
	const packages = [];
	function walk(dir) {
		let entries;
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (skipAll.has(entry)) continue;
			const fullPath = join(dir, entry);
			let stat;
			try {
				stat = statSync(fullPath);
			} catch {
				continue;
			}
			if (!stat.isDirectory()) continue;
			for (const [manifest, ecosystem] of MANIFEST_MAP) {
				if (!existsSync(join(fullPath, manifest))) continue;
				packages.push({
					path: relative(root, fullPath),
					ecosystem,
					manifest,
					supported: SUPPORTED_ECOSYSTEMS.has(ecosystem)
				});
			}
			walk(fullPath);
		}
	}
	walk(root);
	return packages;
}
//#endregion
//#region src/discovery/heuristics.ts
const ARTIFACT_FILENAMES = [
	"openapi.json",
	"openapi.yaml",
	"swagger.json",
	"tokens.json"
];
/**
* Detect potential bridge candidates between packages of different ecosystems.
*/
async function detectBridges(root, packages) {
	const candidates = [];
	const packagesByPath = new Map(packages.map((p) => [p.path, p]));
	for (const pkg of packages) {
		const pkgDir = resolve(root, pkg.path);
		for (const artifactName of ARTIFACT_FILENAMES) {
			const artifactPath = join(pkgDir, artifactName);
			if (!existsSync(artifactPath)) continue;
			const artifactRel = relative(root, artifactPath);
			for (const other of packages) {
				if (other.path === pkg.path || other.ecosystem === pkg.ecosystem) continue;
				if (isPlausibleConsumer(pkg.path, other.path)) candidates.push({
					source: pkg.path,
					consumers: [other.path],
					artifact: artifactRel,
					reason: `Found ${artifactName} in ${pkg.path}`
				});
			}
		}
	}
	for (const pkg of packages) {
		if (pkg.ecosystem !== "dart") continue;
		const pubspecPath = join(root, pkg.path, "pubspec.yaml");
		try {
			const raw = await readFile(pubspecPath, "utf-8");
			const pathDepPattern = /path:\s+(.+)/g;
			let match;
			while ((match = pathDepPattern.exec(raw)) !== null) {
				const depPath = match[1]?.trim();
				if (!depPath) continue;
				const relPath = relative(root, resolve(root, pkg.path, depPath));
				const targetPkg = packagesByPath.get(relPath);
				if (targetPkg && targetPkg.ecosystem !== "dart") candidates.push({
					source: targetPkg.path,
					consumers: [pkg.path],
					artifact: `${targetPkg.path}/openapi.json`,
					reason: `Dart path dependency from ${pkg.path} to ${targetPkg.path}`
				});
			}
		} catch {}
	}
	const merged = /* @__PURE__ */ new Map();
	for (const candidate of candidates) {
		const key = `${candidate.source}::${candidate.artifact}`;
		const existing = merged.get(key);
		if (existing) {
			const allConsumers = [...new Set([...existing.consumers, ...candidate.consumers])];
			merged.set(key, {
				...existing,
				consumers: allConsumers
			});
		} else merged.set(key, candidate);
	}
	return [...merged.values()];
}
/**
* Check if a consumer path is plausibly related to a producer path.
* E.g., packages/api/clients/dart is a plausible consumer of packages/api.
*/
function isPlausibleConsumer(producerPath, consumerPath) {
	if (consumerPath.startsWith(producerPath + "/")) return true;
	if (dirname(producerPath) === dirname(consumerPath)) return true;
	return false;
}
/**
* Find .env.example and .env.template files across the repo.
*/
function detectEnvFiles(root, packages) {
	const candidates = [];
	const envNames = [".env.example", ".env.template"];
	for (const pkg of packages) {
		const pkgDir = resolve(root, pkg.path);
		for (const envName of envNames) {
			const envPath = join(pkgDir, envName);
			if (existsSync(envPath)) candidates.push({ path: relative(root, envPath) });
		}
	}
	return candidates;
}
//#endregion
//#region src/commands/migrate.ts
/** Strip single-line (//) and block comments from JSONC, preserving strings. */
function stripJsonComments(raw) {
	return raw.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_match, quoted) => quoted ?? "");
}
function parseJsonOrJsonc(raw) {
	return JSON.parse(stripJsonComments(raw));
}
/** Read and parse a JSON/JSONC file if it exists. Returns null on missing or parse error. */
async function readJsonConfig(filePath) {
	if (!existsSync(filePath)) return null;
	try {
		const parsed = parseJsonOrJsonc(await readFile(filePath, "utf-8"));
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
/**
* Load a JS/TS config file via dynamic import().
* Returns the default export if it's an object, null otherwise.
*/
async function loadJsConfig(filePath) {
	try {
		const mod = await import(pathToFileURL(filePath).href);
		if (!isRecord(mod)) return null;
		const config = mod["default"] ?? mod;
		return isRecord(config) ? config : null;
	} catch {
		return null;
	}
}
/** Read an ignore file (one pattern per line, skip comments and blanks). */
async function readIgnorePatterns(filePath) {
	if (!existsSync(filePath)) return [];
	try {
		return (await readFile(filePath, "utf-8")).split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
	} catch {
		return [];
	}
}
/** Prompt to remove a file. Returns true if removed. */
async function promptRemoveFile(filePath, label, onCancel) {
	const answer = await confirm({
		message: `Remove ${label}? (config now lives in mido.yml)`,
		initialValue: true
	});
	if (isCancel(answer)) onCancel();
	if (answer) {
		await unlink(filePath);
		log.step(`Removed ${label}`);
		return true;
	}
	return false;
}
const OXLINT_JSON_CONFIGS = [".oxlintrc.json"];
const OXLINT_JS_CONFIGS = ["oxlint.config.ts", "oxlint.config.js"];
/**
* Extract the mido lint section from an oxlint config object.
* Produces ecosystem-centric structure: { ignore, typescript: { categories, rules } }
*/
function extractLintConfig(parsed) {
	const lint = {};
	const ts = {};
	if (isRecord(parsed["categories"]) && Object.keys(parsed["categories"]).length > 0) ts["categories"] = parsed["categories"];
	if (isRecord(parsed["rules"]) && Object.keys(parsed["rules"]).length > 0) ts["rules"] = parsed["rules"];
	if (Object.keys(ts).length > 0) lint["typescript"] = ts;
	if (Array.isArray(parsed["ignorePatterns"]) && parsed["ignorePatterns"].length > 0) lint["ignore"] = parsed["ignorePatterns"];
	return lint;
}
const OXFMT_JSON_CONFIGS = [
	".oxfmtrc.json",
	".oxfmtrc.jsonc",
	".prettierrc.json",
	".prettierrc"
];
const IGNORE_FILES = [".oxfmtignore", ".prettierignore"];
const FORMAT_META_KEYS = new Set(["$schema"]);
/**
* Extract all formatting options from an oxfmt/prettier config.
* Produces ecosystem-centric structure: { typescript: { printWidth, semi, ... } }
*/
function extractFormatConfig(parsed) {
	const ts = {};
	for (const [key, value] of Object.entries(parsed)) if (!FORMAT_META_KEYS.has(key)) ts[key] = value;
	if (Object.keys(ts).length === 0) return {};
	return { typescript: ts };
}
const STALE_ESLINT_CONFIGS = [
	".eslintrc.json",
	".eslintrc.js",
	".eslintrc.cjs",
	".eslintrc.yml",
	".eslintrc.yaml",
	".eslintrc"
];
const STALE_PRETTIER_CONFIGS = [
	".prettierrc",
	".prettierrc.json",
	".prettierignore"
];
/**
* Migrate existing lint/format config files into mido.yml sections.
*
* Detects:
*  - oxlint: .oxlintrc.json, oxlint.config.ts, oxlint.config.js
*  - oxfmt:  .oxfmtrc.json, .oxfmtrc.jsonc, .prettierrc.json, .prettierrc
*  - ignore: .oxfmtignore, .prettierignore
*
* After migration, offers to remove stale eslint/prettier config files.
*/
async function migrateLintFormatConfig(root, onCancel) {
	const migrated = {};
	const removedFiles = /* @__PURE__ */ new Set();
	for (const name of OXLINT_JSON_CONFIGS) {
		const filePath = join(root, name);
		const parsed = await readJsonConfig(filePath);
		if (!parsed) continue;
		const lint = extractLintConfig(parsed);
		if (Object.keys(lint).length > 0) {
			migrated.lint = lint;
			log.info(`Migrated ${name} into mido.yml lint section`);
		}
		if (await promptRemoveFile(filePath, name, onCancel)) removedFiles.add(name);
		break;
	}
	if (!migrated.lint) for (const name of OXLINT_JS_CONFIGS) {
		const filePath = join(root, name);
		if (!existsSync(filePath)) continue;
		const parsed = await loadJsConfig(filePath);
		if (parsed) {
			const lint = extractLintConfig(parsed);
			if (Object.keys(lint).length > 0) {
				migrated.lint = lint;
				log.info(`Migrated ${name} into mido.yml lint section`);
			}
			if (await promptRemoveFile(filePath, name, onCancel)) removedFiles.add(name);
		} else {
			log.warn(`Could not load ${name} — migrate manually into the lint section of mido.yml`);
			if (await promptRemoveFile(filePath, name, onCancel)) removedFiles.add(name);
		}
		break;
	}
	for (const name of OXFMT_JSON_CONFIGS) {
		const filePath = join(root, name);
		const parsed = await readJsonConfig(filePath);
		if (!parsed) continue;
		const format = extractFormatConfig(parsed);
		if (Object.keys(format).length > 0) {
			migrated.format = format;
			log.info(`Migrated ${name} into mido.yml format section`);
		}
		if (await promptRemoveFile(filePath, name, onCancel)) removedFiles.add(name);
		break;
	}
	for (const name of IGNORE_FILES) {
		const filePath = join(root, name);
		const patterns = await readIgnorePatterns(filePath);
		if (patterns.length === 0) continue;
		if (!migrated.format) migrated.format = {};
		const existingIgnore = Array.isArray(migrated.format["ignore"]) ? migrated.format["ignore"] : [];
		migrated.format["ignore"] = [...existingIgnore, ...patterns];
		log.info(`Migrated ${name} patterns into mido.yml format.ignore`);
		if (await promptRemoveFile(filePath, name, onCancel)) removedFiles.add(name);
	}
	if (migrated.lint) for (const name of STALE_ESLINT_CONFIGS) {
		if (removedFiles.has(name)) continue;
		const filePath = join(root, name);
		if (!existsSync(filePath)) continue;
		const answer = await confirm({
			message: `${name} found — mido now uses oxlint. Remove?`,
			initialValue: true
		});
		if (isCancel(answer)) onCancel();
		if (answer) {
			await unlink(filePath);
			log.step(`Removed ${name}`);
		}
	}
	if (migrated.format) for (const name of STALE_PRETTIER_CONFIGS) {
		if (removedFiles.has(name)) continue;
		const filePath = join(root, name);
		if (!existsSync(filePath)) continue;
		const answer = await confirm({
			message: `${name} found — mido now uses oxfmt. Remove?`,
			initialValue: true
		});
		if (isCancel(answer)) onCancel();
		if (answer) {
			await unlink(filePath);
			log.step(`Removed ${name}`);
		}
	}
	return migrated;
}
/**
* Deep-merge migrated tool config into the generated config.
* Migrated values override defaults (e.g., migrated rules replace empty rules).
*/
function mergeMigratedConfig(config, migrated) {
	if (migrated.lint && isRecord(migrated.lint)) {
		const base = isRecord(config["lint"]) ? config["lint"] : {};
		for (const [key, value] of Object.entries(migrated.lint)) if (key === "typescript" && isRecord(value) && isRecord(base["typescript"])) base["typescript"] = {
			...base["typescript"],
			...value
		};
		else base[key] = value;
		config["lint"] = base;
	}
	if (migrated.format && isRecord(migrated.format)) {
		const base = isRecord(config["format"]) ? config["format"] : {};
		for (const [key, value] of Object.entries(migrated.format)) if (key === "typescript" && isRecord(value) && isRecord(base["typescript"])) base["typescript"] = {
			...base["typescript"],
			...value
		};
		else base[key] = value;
		config["format"] = base;
	}
}
//#endregion
//#region src/config/defaults.ts
/** Default oxfmt (TypeScript formatter) options — used by init and schema generation */
const OXFMT_DEFAULTS = {
	printWidth: 80,
	tabWidth: 2,
	useTabs: false,
	semi: true,
	singleQuote: false,
	jsxSingleQuote: false,
	trailingComma: "all",
	bracketSpacing: true,
	bracketSameLine: false,
	arrowParens: "always",
	proseWrap: "preserve",
	singleAttributePerLine: false,
	endOfLine: "lf"
};
/** Default dart format options */
const DART_FORMAT_DEFAULTS = { lineLength: 80 };
/** Default lint category levels for TypeScript */
const LINT_CATEGORY_DEFAULTS = {
	correctness: "error",
	suspicious: "warn",
	perf: "warn"
};
/** Default ignore patterns for lint and format */
const DEFAULT_IGNORE = [
	"dist",
	"build",
	"**/*.g.dart",
	"**/*.freezed.dart",
	"**/*.generated.dart"
];
//#endregion
//#region src/commands/utils/prompts.ts
async function promptWatchPaths(root, source, suggestion, currentWatch) {
	const defaultWatch = `${source}/**`;
	const options = [];
	if (suggestion) {
		const suggestedLabel = suggestion.paths.join(", ");
		options.push({
			value: "suggestion",
			label: suggestedLabel,
			hint: `detected: ${suggestion.reason}`
		});
	}
	const skipHint = currentWatch?.length ? `keep: ${currentWatch.join(", ")}` : `default: ${defaultWatch}`;
	options.push({
		value: "browse",
		label: "Browse for a different path"
	}, {
		value: "manual",
		label: "Enter manually"
	}, {
		value: "skip",
		label: "Skip",
		hint: skipHint
	});
	const choice = await select({
		message: "Watch paths for this bridge:",
		options,
		initialValue: suggestion ? "suggestion" : "browse"
	});
	if (isCancel(choice)) handleCancel();
	switch (choice) {
		case "suggestion": return suggestion?.paths;
		case "browse": {
			const browsed = await path({
				message: "Select directory to watch:",
				root,
				directory: true
			});
			if (isCancel(browsed)) handleCancel();
			return [`${relative(root, join(root, browsed))}/**`];
		}
		case "manual": {
			const entered = await text({
				message: "Watch paths (comma-separated globs):",
				placeholder: defaultWatch
			});
			if (isCancel(entered)) handleCancel();
			if (!entered) return;
			return entered.split(/[,\s]+/).map((p) => p.trim()).filter((p) => p.length > 0);
		}
		default: return currentWatch?.length ? currentWatch : void 0;
	}
}
async function promptModifyBridge(root, config, current, pluginRegistry, packageMap) {
	const allPaths = getAllPackagePaths(config);
	const source = await select({
		message: `Source (currently: ${current.source}):`,
		options: allPaths.map((p) => ({
			value: p,
			label: p
		})),
		initialValue: current.source
	});
	if (isCancel(source)) handleCancel();
	const consumerPaths = allPaths.filter((p) => p !== source);
	const consumers = await multiselect({
		message: `Consumers (currently: [${current.consumers.join(", ")}]):`,
		options: consumerPaths.map((p) => ({
			value: p,
			label: p,
			selected: current.consumers.includes(p)
		})),
		required: true
	});
	if (isCancel(consumers)) handleCancel();
	const artifact = await path({
		message: `Artifact (currently: ${current.artifact}):`,
		root,
		initialValue: current.artifact
	});
	if (isCancel(artifact)) handleCancel();
	const relArtifact = relative(root, join(root, artifact));
	let modifySuggestion = null;
	if (pluginRegistry && packageMap) {
		const sourcePkg = packageMap.get(source);
		if (sourcePkg) modifySuggestion = await pluginRegistry.suggestWatchPaths(sourcePkg, relArtifact, packageMap, root);
	}
	return {
		source,
		consumers,
		artifact: relArtifact,
		watch: await promptWatchPaths(root, source, modifySuggestion, current.watch)
	};
}
async function promptAdditionalBridges(root, packagePaths) {
	const result = [];
	const addMore = await confirm({
		message: "Any additional bridges?",
		initialValue: false
	});
	if (isCancel(addMore)) handleCancel();
	if (!addMore) return result;
	let adding = true;
	while (adding) {
		const source = await select({
			message: "Source (who generates the file):",
			options: packagePaths.map((p) => ({
				value: p,
				label: p
			}))
		});
		if (isCancel(source)) handleCancel();
		const consumers = await multiselect({
			message: "Consumers (who depends on it):",
			options: packagePaths.filter((p) => p !== source).map((p) => ({
				value: p,
				label: p
			})),
			required: true
		});
		if (isCancel(consumers)) handleCancel();
		const artifact = await path({
			message: "Artifact (shared file, e.g. openapi.json):",
			root
		});
		if (isCancel(artifact)) handleCancel();
		const relArtifact = relative(root, join(root, artifact));
		const fullArtifactPath = join(root, relArtifact);
		if (existsSync(fullArtifactPath)) try {
			if (statSync(fullArtifactPath).isDirectory()) {
				log.warn("Artifact must be a file, not a directory. Skipping bridge.");
				const retry = await confirm({
					message: "Add another bridge?",
					initialValue: false
				});
				if (isCancel(retry)) handleCancel();
				adding = retry;
				continue;
			}
		} catch {}
		else {
			const proceed = await confirm({
				message: "File not found — it may not be generated yet. Continue?",
				initialValue: false
			});
			if (isCancel(proceed)) handleCancel();
			if (!proceed) {
				const retry = await confirm({
					message: "Add another bridge?",
					initialValue: false
				});
				if (isCancel(retry)) handleCancel();
				adding = retry;
				continue;
			}
		}
		const watch = await promptWatchPaths(root, source);
		result.push({
			source,
			consumers,
			artifact: relArtifact,
			watch
		});
		log.step(`Bridge: ${ORANGE}${source}${RESET} ${DIM}\u2192${RESET} ${ORANGE}[${consumers.join(", ")}]${RESET} ${DIM}via${RESET} ${BOLD}${relArtifact}${RESET}`);
		const another = await confirm({
			message: "Add another bridge?",
			initialValue: false
		});
		if (isCancel(another)) handleCancel();
		adding = another;
	}
	return result;
}
//#endregion
//#region src/commands/utils/cleanup.ts
async function runPostInitCheck(parsers) {
	if (await runCheck(parsers, { quiet: true }) === 0) {
		log.success(`${GREEN}All checks passed${RESET}`);
		return true;
	}
	const { config, root } = await loadConfig();
	const { buildWorkspaceGraph } = await import("./workspace-D1ScM76h.js").then((n) => n.n);
	const { findVersionMismatches } = await import("./versions-C6rnLx1z.js").then((n) => n.i);
	const { loadLock } = await import("./lock-0DJ_gelN.js").then((n) => n.i);
	const mismatches = findVersionMismatches(await buildWorkspaceGraph(config, root, parsers), await loadLock(root));
	if (mismatches.length === 0) {
		log.warn(`${DIM}Some checks failed. Run${RESET} ${BOLD}mido check${RESET} ${DIM}to see details.${RESET}`);
		return false;
	}
	const fix = await confirm({
		message: `Found ${mismatches.length} version mismatch(es). Fix now?`,
		initialValue: true
	});
	if (isCancel(fix)) handleCancel();
	if (fix) return await runCheck(parsers, { fix: true }) === 0;
	return false;
}
const HELP_LINES = [
	`${BOLD}mido dev${RESET}              ${DIM}Watch bridges and regenerate on changes${RESET}`,
	`${BOLD}mido check${RESET}            ${DIM}Run all workspace consistency checks${RESET}`,
	`${BOLD}mido check --fix${RESET}      ${DIM}Interactively resolve version mismatches${RESET}`,
	`${BOLD}mido install${RESET}          ${DIM}Install git hooks${RESET}`
].join("\n");
async function promptNextSteps(parsers, summary) {
	const summaryLines = [];
	summaryLines.push(`${GREEN}${BOLD}${CONFIG_FILENAME}${RESET} ${DIM}written${RESET}`);
	summaryLines.push(`${DIM}${summary.packageCount} package(s) across ${summary.ecosystemCount} ecosystem(s)${RESET}`);
	if (summary.bridgeCount > 0) summaryLines.push(`${ORANGE}${summary.bridgeCount}${RESET} ${DIM}bridge(s) configured${RESET}`);
	if (summary.hooksInstalled) summaryLines.push(`${DIM}git hooks installed${RESET}`);
	if (summary.checksPass) summaryLines.push(`${GREEN}all checks passed${RESET}`);
	note(summaryLines.join("\n"), `${ORANGE}${BOLD}Workspace ready${RESET}`);
	const next = await select({
		message: "What's next?",
		options: [
			{
				value: "dev",
				label: "Start watching",
				hint: "mido dev"
			},
			{
				value: "check",
				label: "Check workspace health",
				hint: "mido check"
			},
			{
				value: "help",
				label: "View help",
				hint: "mido help"
			},
			{
				value: "exit",
				label: "Exit"
			}
		]
	});
	if (isCancel(next)) {
		outro(`${DIM}Happy coding!${RESET}`);
		return 0;
	}
	switch (next) {
		case "dev": {
			outro(`${ORANGE}Starting watcher...${RESET}`);
			const { runDev } = await import("./dev-DPXsW2gy.js");
			return runDev(parsers, {});
		}
		case "check":
			outro(`${ORANGE}Running checks...${RESET}`);
			return runCheck(parsers, {});
		case "help":
			note(HELP_LINES, `${ORANGE}${BOLD}Commands${RESET}`);
			outro(`${DIM}Happy coding!${RESET}`);
			return 0;
		default:
			outro(`${DIM}Happy coding!${RESET}`);
			return 0;
	}
}
const REPLACEABLE_TOOLS = [
	{
		name: "Husky",
		replacement: "mido install (git hooks)",
		deps: ["husky"],
		configs: [],
		dirs: [".husky"]
	},
	{
		name: "commitlint",
		replacement: "mido commit-msg (conventional commits)",
		deps: [
			"@commitlint/cli",
			"@commitlint/config-conventional",
			"@commitlint/config-angular"
		],
		configs: [
			"commitlint.config.js",
			"commitlint.config.cjs",
			"commitlint.config.ts",
			".commitlintrc.js",
			".commitlintrc.json",
			".commitlintrc.yml"
		],
		dirs: []
	},
	{
		name: "lint-staged",
		replacement: "mido pre-commit",
		deps: ["lint-staged"],
		configs: [
			".lintstagedrc",
			".lintstagedrc.json",
			".lintstagedrc.yml",
			".lintstagedrc.js"
		],
		dirs: []
	},
	{
		name: "Prettier",
		replacement: "mido fmt (oxfmt, bundled)",
		deps: ["prettier"],
		configs: [
			".prettierrc",
			".prettierrc.json",
			".prettierrc.yml",
			".prettierrc.yaml",
			".prettierrc.js",
			".prettierrc.cjs",
			"prettier.config.js",
			"prettier.config.cjs",
			".prettierignore"
		],
		dirs: []
	},
	{
		name: "ESLint",
		replacement: "mido lint (oxlint, bundled)",
		deps: ["eslint"],
		configs: [
			".eslintrc.json",
			".eslintrc.js",
			".eslintrc.cjs",
			".eslintrc.yml",
			".eslintrc.yaml",
			".eslintrc",
			"eslint.config.js",
			"eslint.config.cjs",
			"eslint.config.mjs",
			".eslintignore"
		],
		dirs: []
	},
	{
		name: "Biome",
		replacement: "mido lint + mido fmt",
		deps: ["@biomejs/biome"],
		configs: ["biome.json", "biome.jsonc"],
		dirs: []
	},
	{
		name: "syncpack",
		replacement: "mido check --fix (version consistency)",
		deps: ["syncpack"],
		configs: [
			".syncpackrc",
			".syncpackrc.json",
			".syncpackrc.yml",
			".syncpackrc.js"
		],
		dirs: []
	},
	{
		name: "oxlint (standalone)",
		replacement: "mido lint (oxlint bundled with mido)",
		deps: ["oxlint"],
		configs: [
			".oxlintrc.json",
			"oxlint.config.ts",
			"oxlint.config.js"
		],
		dirs: []
	},
	{
		name: "oxfmt (standalone)",
		replacement: "mido fmt (oxfmt bundled with mido)",
		deps: ["oxfmt"],
		configs: [
			".oxfmtrc.json",
			".oxfmtrc.jsonc",
			".oxfmtignore"
		],
		dirs: []
	}
];
function detectTools(root, devDeps) {
	const found = [];
	for (const tool of REPLACEABLE_TOOLS) {
		const foundDeps = devDeps ? tool.deps.filter((d) => d in devDeps) : [];
		const foundConfigs = tool.configs.filter((c) => existsSync(join(root, c)));
		const foundDirs = tool.dirs.filter((d) => existsSync(join(root, d)));
		if (foundDeps.length > 0 || foundConfigs.length > 0 || foundDirs.length > 0) found.push({
			tool,
			foundDeps,
			foundConfigs,
			foundDirs
		});
	}
	return found;
}
/**
* Detect all tools that mido replaces, show a summary table,
* and offer to remove them.
*/
async function cleanupReplacedTooling(root) {
	const pkgJsonPath = join(root, "package.json");
	let devDeps;
	if (existsSync(pkgJsonPath)) {
		const raw = await readFile(pkgJsonPath, "utf-8");
		const pkg = JSON.parse(raw);
		if (isRecord(pkg)) {
			const devDepsRaw = pkg["devDependencies"];
			devDeps = isRecord(devDepsRaw) ? devDepsRaw : void 0;
		}
	}
	const found = detectTools(root, devDeps);
	if (found.length === 0) return;
	note(found.map((f) => {
		const items = [
			...f.foundDeps.map((d) => `dep: ${d}`),
			...f.foundConfigs,
			...f.foundDirs.map((d) => `${d}/`)
		];
		return `  ${ORANGE}${f.tool.name}${RESET} ${DIM}→ ${f.tool.replacement}${RESET}\n    ${DIM}found: ${items.join(", ")}${RESET}`;
	}).join("\n\n"), `${ORANGE}${BOLD}mido replaces ${found.length} tool(s)${RESET}`);
	const cleanup = await confirm({
		message: "Remove replaced tools? (configs, devDependencies, directories)",
		initialValue: true
	});
	if (isCancel(cleanup)) handleCancel();
	if (!cleanup) return;
	const allDeps = [];
	const allConfigs = [];
	const allDirs = [];
	for (const f of found) {
		allDeps.push(...f.foundDeps);
		allConfigs.push(...f.foundConfigs);
		allDirs.push(...f.foundDirs);
	}
	for (const config of allConfigs) {
		const filePath = join(root, config);
		if (existsSync(filePath)) {
			await unlink(filePath);
			log.step(`Removed ${config}`);
		}
	}
	for (const dir of allDirs) {
		const dirPath = join(root, dir);
		if (existsSync(dirPath)) {
			await rm(dirPath, { recursive: true });
			log.step(`Removed ${dir}/`);
		}
	}
	if (existsSync(pkgJsonPath)) {
		const raw = await readFile(pkgJsonPath, "utf-8");
		const pkg = JSON.parse(raw);
		if (isRecord(pkg) && "lint-staged" in pkg) {
			delete pkg["lint-staged"];
			await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
			log.step("Removed lint-staged config from package.json");
		}
	}
	if (allDeps.length > 0) {
		const cmd = detectRemoveCommand(root);
		const full = `${cmd} ${allDeps.join(" ")}`;
		log.step(`$ ${full}`);
		const parts = cmd.split(" ");
		const bin = parts[0];
		const baseArgs = parts.slice(1);
		if (bin) spawnSync(bin, [...baseArgs, ...allDeps], {
			cwd: root,
			stdio: "inherit"
		});
	}
	if (existsSync(pkgJsonPath)) {
		const freshRaw = await readFile(pkgJsonPath, "utf-8");
		const freshPkg = JSON.parse(freshRaw);
		if (isRecord(freshPkg)) {
			const scriptsRaw = freshPkg["scripts"];
			const scripts = isRecord(scriptsRaw) ? scriptsRaw : void 0;
			if (scripts && typeof scripts["prepare"] === "string") {
				const prepare = scripts["prepare"];
				if (prepare === "husky" || prepare === "husky install") {
					scripts["prepare"] = "mido generate";
					await writeFile(pkgJsonPath, JSON.stringify(freshPkg, null, 2) + "\n", "utf-8");
					log.step("Updated scripts.prepare → \"mido generate\"");
				}
			}
		}
	}
	log.success(`Removed ${allConfigs.length + allDirs.length} config(s) and ${allDeps.length} dep(s)`);
}
const LOCKFILE_TO_REMOVE_CMD = new Map([
	["bun.lock", "bun remove"],
	["bun.lockb", "bun remove"],
	["pnpm-lock.yaml", "pnpm remove"],
	["yarn.lock", "yarn remove"],
	["package-lock.json", "npm uninstall"]
]);
function detectRemoveCommand(root) {
	for (const [lockfile, cmd] of LOCKFILE_TO_REMOVE_CMD) if (existsSync(join(root, lockfile))) return cmd;
	return "npm uninstall";
}
//#endregion
//#region src/commands/utils/shared.ts
const CONFIG_FILENAME = "mido.yml";
const ECOSYSTEM_MANIFESTS = {
	typescript: "package.json",
	dart: "pubspec.yaml"
};
var CancelError = class extends Error {
	constructor() {
		super("Aborted.");
		this.name = "CancelError";
	}
};
function handleCancel() {
	cancel("Aborted.");
	throw new CancelError();
}
/**
* Build a lightweight WorkspacePackage map from discovered packages.
* Used during init to provide context to plugin watch path suggestions
* before the full workspace graph is built.
*/
function buildPackageMap(packages) {
	const map = /* @__PURE__ */ new Map();
	for (const pkg of packages) map.set(pkg.path, {
		name: pkg.path.split("/").pop() ?? pkg.path,
		path: pkg.path,
		ecosystem: pkg.ecosystem,
		version: void 0,
		dependencies: [],
		localDependencies: []
	});
	return map;
}
function getAllPackagePaths(config) {
	const paths = [];
	for (const group of Object.values(config.ecosystems)) paths.push(...group.packages);
	return paths.sort();
}
function addPackageToConfig(config, pkg) {
	const eco = config.ecosystems[pkg.ecosystem];
	if (eco) config.ecosystems[pkg.ecosystem] = {
		...eco,
		packages: [...eco.packages, pkg.path].sort()
	};
	else config.ecosystems[pkg.ecosystem] = {
		manifest: ECOSYSTEM_MANIFESTS[pkg.ecosystem] ?? pkg.manifest,
		packages: [pkg.path]
	};
}
function removePackageFromConfig(config, path) {
	for (const [ecoName, group] of Object.entries(config.ecosystems)) {
		if (!group.packages.includes(path)) continue;
		const remaining = group.packages.filter((p) => p !== path);
		if (remaining.length === 0) delete config.ecosystems[ecoName];
		else config.ecosystems[ecoName] = {
			...group,
			packages: remaining
		};
		return;
	}
}
function formatEcosystemList(ecosystems) {
	const lines = [];
	for (const [name, group] of Object.entries(ecosystems)) {
		lines.push(`  ${ORANGE}${BOLD}${name}${RESET} ${DIM}(${group.packages.length} packages)${RESET}`);
		for (const pkg of group.packages) lines.push(`    ${DIM}${pkg}${RESET}`);
	}
	return lines.join("\n");
}
function groupDiscoveredByEcosystem(packages) {
	const temp = {};
	for (const pkg of packages) {
		if (!temp[pkg.ecosystem]) temp[pkg.ecosystem] = {
			manifest: ECOSYSTEM_MANIFESTS[pkg.ecosystem] ?? pkg.manifest,
			packages: []
		};
		temp[pkg.ecosystem]?.packages.push(pkg.path);
	}
	const groups = {};
	for (const [eco, group] of Object.entries(temp)) groups[eco] = {
		manifest: group.manifest,
		packages: group.packages.sort()
	};
	return groups;
}
//#endregion
//#region src/commands/utils/config-render.ts
function configToObject(config) {
	const obj = {
		workspace: config.workspace,
		ecosystems: config.ecosystems
	};
	if (config.bridges && config.bridges.length > 0) obj["bridges"] = config.bridges;
	if (config.env) obj["env"] = config.env;
	if (config.commits) obj["commits"] = config.commits;
	if (config.lint) obj["lint"] = config.lint;
	if (config.format) obj["format"] = config.format;
	return obj;
}
function buildConfigObject(name, ecosystems, bridges, envFiles) {
	const config = {
		workspace: name,
		ecosystems
	};
	if (bridges.length > 0) config["bridges"] = bridges.map((b) => {
		const entry = {
			source: b.source,
			artifact: b.artifact,
			consumers: [...b.consumers]
		};
		if (b.watch?.length) entry["watch"] = b.watch;
		return entry;
	});
	if (envFiles.length >= 2) config["env"] = {
		shared: [],
		files: envFiles.map((e) => e.path)
	};
	const formatSection = { ignore: [...DEFAULT_IGNORE] };
	if (ecosystems["typescript"]) formatSection["typescript"] = { ...OXFMT_DEFAULTS };
	if (ecosystems["dart"]) formatSection["dart"] = { ...DART_FORMAT_DEFAULTS };
	config["format"] = formatSection;
	const lintSection = { ignore: [...DEFAULT_IGNORE] };
	if (ecosystems["typescript"]) lintSection["typescript"] = {
		categories: { ...LINT_CATEGORY_DEFAULTS },
		rules: {}
	};
	if (ecosystems["dart"]) lintSection["dart"] = { strict: false };
	config["lint"] = lintSection;
	const scopes = [];
	for (const group of Object.values(ecosystems)) for (const pkg of group.packages) {
		const scope = pkg.split("/").pop();
		if (scope && !scopes.includes(scope)) scopes.push(scope);
	}
	config["commits"] = {
		types: [
			"feat",
			"fix",
			"docs",
			"style",
			"refactor",
			"perf",
			"test",
			"build",
			"ci",
			"chore",
			"revert"
		],
		scopes: scopes.sort(),
		header_max_length: 100,
		body_max_line_length: 200
	};
	config["hooks"] = {
		"pre-commit": ["mido pre-commit"],
		"commit-msg": ["mido commit-msg \"$1\""],
		"post-merge": ["mido check --quiet || echo \"⚠ mido: workspace drift detected — run mido check --fix\""],
		"post-checkout": ["mido check --quiet || echo \"⚠ mido: workspace drift detected — run mido check --fix\""]
	};
	return config;
}
const YAML_COMMENTS = new Map([
	["workspace", " ─── Workspace ─────────────────────────────────────────────\n Workspace name (used in generated package names and CLI output)"],
	["ecosystems", " ─── Ecosystems ────────────────────────────────────────────\n Declare which languages your workspace uses and where\n packages live. mido auto-detects these during init."],
	["bridges", " ─── Bridges ───────────────────────────────────────────────\n Cross-ecosystem dependencies linked by a shared artifact.\n\n source:    package that produces the artifact\n consumers: packages that consume the artifact\n artifact:  the file that connects them\n watch:    files to monitor for changes (used by mido dev)"],
	["env", " ─── Environment ───────────────────────────────────────────\n Environment variable parity across packages"],
	["format", " ─── Formatting ────────────────────────────────────────────\n Per-ecosystem formatting. mido picks the right tool:\n   TypeScript → oxfmt (bundled with mido)\n   Dart       → dart format\n\n All tool defaults are shown. Change any value to override."],
	["lint", " ─── Linting ───────────────────────────────────────────────\n Per-ecosystem linting. mido picks the right tool:\n   TypeScript → oxlint (bundled with mido)\n   Dart       → dart analyze\n\n mido auto-enables appropriate oxlint plugins based on\n your dependencies (typescript, unicorn, oxc, import by\n default — react, jsx-a11y, react-perf if React detected)."],
	["commits", " ─── Commits ───────────────────────────────────────────────\n Conventional commit validation, enforced by mido's\n commit-msg git hook. Run `mido install` to set up hooks."],
	["hooks", " ─── Hooks ─────────────────────────────────────────────────\n Git hooks installed by `mido install`. Each hook is a\n list of shell commands run sequentially (stops on first\n failure). Set a hook to `false` to disable it.\n Changes are applied on `mido install` or when mido.yml\n is saved during `mido dev`."]
]);
function renderYaml(config) {
	const doc = new Document(config);
	doc.commentBefore = " yaml-language-server: $schema=node_modules/@oddlantern/mido/schema.json\n\n ─────────────────────────────────────────────────────────\n mido — Cross-ecosystem workspace configuration\n Docs: https://github.com/oddlantern/mido\n ─────────────────────────────────────────────────────────";
	if (isMap(doc.contents)) for (const pair of doc.contents.items) {
		if (!isScalar(pair.key)) continue;
		const comment = YAML_COMMENTS.get(String(pair.key.value));
		if (comment) pair.key.commentBefore = comment;
	}
	return doc.toString({ lineWidth: 120 });
}
//#endregion
//#region src/commands/reconcile.ts
async function runReconciliation(root, configPath, parsers) {
	printBanner();
	intro("mido init — reconciling with existing config");
	const s = spinner();
	s.start("Scanning repo and comparing with mido.yml...");
	const supported = scanRepo(root).filter((p) => p.supported);
	let existing;
	try {
		existing = (await loadConfig(root)).config;
	} catch (err) {
		s.stop("Failed to load existing config");
		const msg = err instanceof Error ? err.message : String(err);
		log.warn(`Could not parse existing ${CONFIG_FILENAME}: ${msg}`);
		const replace = await confirm({
			message: "Replace with a fresh scan?",
			initialValue: true
		});
		if (isCancel(replace) || !replace) handleCancel();
		const { unlink } = await import("node:fs/promises");
		await unlink(configPath);
		log.step(`Removed broken ${CONFIG_FILENAME}`);
		const { runInit } = await import("./init-ChNlgDxr.js");
		return runInit(root, parsers);
	}
	s.stop("Scan complete");
	const { ecosystem, domain } = loadPlugins();
	const pluginRegistry = new PluginRegistry(ecosystem, domain);
	const reconPackageMap = buildPackageMap(supported);
	const existingPaths = /* @__PURE__ */ new Set();
	const existingEcosystemForPath = /* @__PURE__ */ new Map();
	for (const [eco, group] of Object.entries(existing.ecosystems)) for (const pkg of group.packages) {
		existingPaths.add(pkg);
		existingEcosystemForPath.set(pkg, eco);
	}
	const discoveredPaths = new Set(supported.map((p) => p.path));
	const kept = [];
	const newPackages = [];
	const missing = [];
	for (const pkg of supported) if (existingPaths.has(pkg.path)) kept.push(pkg.path);
	else newPackages.push(pkg);
	for (const path of existingPaths) if (!discoveredPaths.has(path)) missing.push(path);
	const statusLines = [];
	for (const path of kept) {
		const eco = existingEcosystemForPath.get(path) ?? "";
		statusLines.push(`  ${GREEN}\u2713${RESET} ${path} ${DIM}(${eco})${RESET}`);
	}
	for (const pkg of newPackages) statusLines.push(`  ${ORANGE}+${RESET} ${ORANGE}${pkg.path}${RESET} ${DIM}(${pkg.ecosystem})${RESET} ${ORANGE}\u2190 NEW${RESET}`);
	for (const path of missing) {
		const eco = existingEcosystemForPath.get(path) ?? "";
		statusLines.push(`  ${DIM}\u26A0 ${path} (${eco}) \u2190 NOT FOUND ON DISK${RESET}`);
	}
	log.info(`Packages:\n${statusLines.join("\n")}`);
	let configChanged = false;
	for (const pkg of newPackages) {
		const add = await confirm({
			message: `${pkg.path} detected. Add to config?`,
			initialValue: true
		});
		if (isCancel(add)) handleCancel();
		if (add) {
			addPackageToConfig(existing, pkg);
			configChanged = true;
		}
	}
	for (const path of missing) {
		const remove = await confirm({
			message: `${path} not found on disk. Remove from config?`,
			initialValue: true
		});
		if (isCancel(remove)) handleCancel();
		if (remove) {
			removePackageFromConfig(existing, path);
			configChanged = true;
		}
	}
	const existingBridges = (existing.bridges ?? []).map((b) => ({
		...b,
		consumers: b.consumers ?? (b.target ? [b.target] : [])
	}));
	const updatedBridges = [];
	for (const bridge of existingBridges) {
		const action = await select({
			message: `Bridge: ${bridge.source} produces ${basename(bridge.artifact)}, consumed by [${bridge.consumers.join(", ")}]`,
			options: [
				{
					value: "keep",
					label: "Keep"
				},
				{
					value: "modify",
					label: "Modify"
				},
				{
					value: "remove",
					label: "Remove"
				}
			]
		});
		if (isCancel(action)) handleCancel();
		if (action === "keep") if (!bridge.watch?.length) {
			const sourcePackage = reconPackageMap.get(bridge.source);
			let reconSuggestion = null;
			if (sourcePackage) reconSuggestion = await pluginRegistry.suggestWatchPaths(sourcePackage, bridge.artifact, reconPackageMap, root);
			if (reconSuggestion) {
				const watch = await promptWatchPaths(root, bridge.source, reconSuggestion);
				if (watch) {
					updatedBridges.push({
						source: bridge.source,
						consumers: bridge.consumers,
						artifact: bridge.artifact,
						watch: [...watch]
					});
					configChanged = true;
				} else updatedBridges.push({
					source: bridge.source,
					consumers: bridge.consumers,
					artifact: bridge.artifact,
					watch: bridge.watch ? [...bridge.watch] : void 0
				});
			} else {
				const addWatch = await confirm({
					message: "Add watch paths for this bridge?",
					initialValue: false
				});
				if (isCancel(addWatch)) handleCancel();
				if (addWatch) {
					const watch = await promptWatchPaths(root, bridge.source);
					if (watch) {
						updatedBridges.push({
							source: bridge.source,
							consumers: bridge.consumers,
							artifact: bridge.artifact,
							watch: [...watch]
						});
						configChanged = true;
					} else updatedBridges.push({
						source: bridge.source,
						consumers: bridge.consumers,
						artifact: bridge.artifact,
						watch: bridge.watch ? [...bridge.watch] : void 0
					});
				} else updatedBridges.push({
					source: bridge.source,
					consumers: bridge.consumers,
					artifact: bridge.artifact,
					watch: bridge.watch ? [...bridge.watch] : void 0
				});
			}
		} else updatedBridges.push({
			source: bridge.source,
			consumers: bridge.consumers,
			artifact: bridge.artifact,
			watch: bridge.watch ? [...bridge.watch] : void 0
		});
		else if (action === "modify") {
			const modified = await promptModifyBridge(root, existing, bridge, pluginRegistry, reconPackageMap);
			if (modified) {
				updatedBridges.push(modified);
				configChanged = true;
			} else updatedBridges.push({
				source: bridge.source,
				consumers: bridge.consumers,
				artifact: bridge.artifact,
				watch: bridge.watch ? [...bridge.watch] : void 0
			});
		} else configChanged = true;
	}
	const manualBridges = await promptAdditionalBridges(root, getAllPackagePaths(existing));
	if (manualBridges.length > 0) {
		configChanged = true;
		for (const b of manualBridges) updatedBridges.push({
			source: b.source,
			consumers: [...b.consumers],
			artifact: b.artifact,
			watch: b.watch?.length ? [...b.watch] : void 0
		});
	}
	const mutable = configToObject(existing);
	if (configChanged || updatedBridges.length !== existingBridges.length) {
		mutable["bridges"] = updatedBridges.length > 0 ? updatedBridges : void 0;
		configChanged = true;
	}
	const migratedToolConfig = await migrateLintFormatConfig(root, handleCancel);
	if (migratedToolConfig.lint || migratedToolConfig.format) {
		mergeMigratedConfig(mutable, migratedToolConfig);
		configChanged = true;
	}
	if (configChanged) {
		await writeFile(configPath, renderYaml(mutable), "utf-8");
		log.success("Config updated");
	} else log.success("No changes needed");
	const installHooks = await confirm({
		message: "Install git hooks?",
		initialValue: true
	});
	if (isCancel(installHooks)) handleCancel();
	let hooksInstalled = false;
	if (installHooks) {
		const { runInstall } = await import("./install-d8yBkguG.js");
		const installResult = await runInstall(root, existing);
		if (installResult !== 0) return installResult;
		hooksInstalled = true;
	}
	await cleanupReplacedTooling(root);
	const checksPass = await runPostInitCheck(parsers);
	let totalPackages = 0;
	for (const group of Object.values(existing.ecosystems)) totalPackages += group.packages.length;
	return promptNextSteps(parsers, {
		packageCount: totalPackages,
		ecosystemCount: Object.keys(existing.ecosystems).length,
		bridgeCount: updatedBridges.length,
		hooksInstalled,
		checksPass
	});
}
//#endregion
//#region src/commands/init.ts
/**
* Add "mido generate" to the prepare script in root package.json.
* If prepare already exists and doesn't mention mido, chains with &&.
*/
async function wirePrepareScript(root) {
	const pkgPath = join(root, "package.json");
	if (!existsSync(pkgPath)) return;
	const raw = await readFile(pkgPath, "utf-8");
	const pkg = JSON.parse(raw);
	if (!isRecord(pkg)) return;
	const scripts = isRecord(pkg["scripts"]) ? pkg["scripts"] : {};
	const current = typeof scripts["prepare"] === "string" ? scripts["prepare"] : "";
	if (current.includes("mido generate")) return;
	scripts["prepare"] = current ? `${current} && mido generate` : "mido generate";
	pkg["scripts"] = scripts;
	await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
	log.step(`Added ${BOLD}"prepare": "mido generate"${RESET} to package.json`);
}
/**
* Add generated/ to .gitignore for bridge source directories.
*/
async function wireGitignore(root, bridges) {
	const gitignorePath = join(root, ".gitignore");
	let content = "";
	if (existsSync(gitignorePath)) content = await readFile(gitignorePath, "utf-8");
	const sources = new Set(bridges.map((b) => b.source));
	const linesToAdd = [];
	for (const source of sources) {
		const entry = `${source}/generated/`;
		if (!content.includes(entry)) linesToAdd.push(entry);
	}
	if (linesToAdd.length === 0) return;
	const section = "\n# mido generated output\n" + linesToAdd.join("\n") + "\n";
	await writeFile(gitignorePath, content.trimEnd() + "\n" + section, "utf-8");
	log.step(`Added ${linesToAdd.length} generated path(s) to .gitignore`);
}
/**
* Interactive setup that scans the repo and generates mido.yml.
* If mido.yml already exists, runs reconciliation mode instead.
*
* @returns exit code (0 = success, 1 = error)
*/
async function runInit(root, parsers) {
	const configPath = join(root, CONFIG_FILENAME);
	if (existsSync(configPath)) return runReconciliation(root, configPath, parsers);
	return runFirstTime(root, configPath, parsers);
}
async function runFirstTime(root, configPath, parsers) {
	printBanner();
	intro("mido init");
	const s = spinner();
	s.start("Scanning repo...");
	const discovered = scanRepo(root);
	s.stop("Scan complete");
	if (discovered.length === 0) {
		log.error("No ecosystem packages found. Nothing to configure.");
		return 1;
	}
	const supported = discovered.filter((p) => p.supported);
	const unsupported = discovered.filter((p) => !p.supported);
	if (unsupported.length > 0) for (const pkg of unsupported) log.warn(`${pkg.ecosystem} detected at ${pkg.path} (not yet supported)`);
	if (supported.length === 0) {
		log.error("No supported ecosystem packages found.");
		return 1;
	}
	const ecosystems = groupDiscoveredByEcosystem(supported);
	const packageLines = formatEcosystemList(ecosystems);
	log.info(`Found ${supported.length} packages across ${Object.keys(ecosystems).length} ecosystems:\n${packageLines}`);
	const adjustPackages = await select({
		message: "Confirm packages?",
		options: [{
			value: "yes",
			label: "Yes, looks correct"
		}, {
			value: "adjust",
			label: "Let me adjust"
		}]
	});
	if (isCancel(adjustPackages)) handleCancel();
	let finalSupported = supported;
	if (adjustPackages === "adjust") {
		const selected = await multiselect({
			message: "Select packages to include:",
			options: supported.map((p) => ({
				value: p.path,
				label: p.path,
				hint: p.ecosystem
			})),
			initialValues: supported.map((p) => p.path),
			required: true
		});
		if (isCancel(selected)) handleCancel();
		const selectedSet = new Set(selected);
		finalSupported = supported.filter((p) => selectedSet.has(p.path));
	}
	const finalEcosystems = groupDiscoveredByEcosystem(finalSupported);
	const detectedBridges = [...await detectBridges(root, finalSupported)];
	if (detectedBridges.length > 0) {
		const bridgeLines = detectedBridges.map((b) => `  ${ORANGE}${b.source}${RESET} ${DIM}\u2192${RESET} ${ORANGE}[${b.consumers.join(", ")}]${RESET} ${DIM}via${RESET} ${BOLD}${b.artifact}${RESET}`).join("\n");
		log.info(`Detected ${ORANGE}${detectedBridges.length}${RESET} bridge(s):\n${bridgeLines}`);
	}
	const { ecosystem, domain } = loadPlugins();
	const pluginRegistry = new PluginRegistry(ecosystem, domain);
	const tmpPackageMap = buildPackageMap(finalSupported);
	const bridgesWithWatch = [];
	for (const b of detectedBridges) {
		const sourcePackage = tmpPackageMap.get(b.source);
		let suggestion = null;
		if (sourcePackage) suggestion = await pluginRegistry.suggestWatchPaths(sourcePackage, b.artifact, tmpPackageMap, root);
		const watch = await promptWatchPaths(root, b.source, suggestion);
		bridgesWithWatch.push({
			source: b.source,
			consumers: b.consumers,
			artifact: b.artifact,
			watch
		});
	}
	const manualBridges = await promptAdditionalBridges(root, finalSupported.map((p) => p.path));
	bridgesWithWatch.push(...manualBridges);
	const envFiles = detectEnvFiles(root, finalSupported);
	if (envFiles.length >= 2) {
		const envLines = envFiles.map((e) => `  ${e.path}`).join("\n");
		log.info(`Env files:\n${envLines}`);
	}
	const dirName = root.split("/").pop() ?? "workspace";
	const nameResult = await text({
		message: "Workspace name:",
		placeholder: dirName,
		defaultValue: dirName
	});
	if (isCancel(nameResult)) handleCancel();
	const name = nameResult || dirName;
	const migratedToolConfig = await migrateLintFormatConfig(root, handleCancel);
	const config = buildConfigObject(name, finalEcosystems, bridgesWithWatch, envFiles);
	mergeMigratedConfig(config, migratedToolConfig);
	await writeFile(configPath, renderYaml(config), "utf-8");
	log.success(`${ORANGE}${CONFIG_FILENAME}${RESET} written`);
	const installHooks = await confirm({
		message: "Install git hooks?",
		initialValue: true
	});
	if (isCancel(installHooks)) handleCancel();
	let hooksInstalled = false;
	if (installHooks) {
		const { runInstall } = await import("./install-d8yBkguG.js");
		const installResult = await runInstall(root);
		if (installResult !== 0) return installResult;
		hooksInstalled = true;
	}
	await cleanupReplacedTooling(root);
	if (bridgesWithWatch.length > 0) {
		await wirePrepareScript(root);
		await wireGitignore(root, bridgesWithWatch);
	}
	const checksPass = await runPostInitCheck(parsers);
	return promptNextSteps(parsers, {
		packageCount: finalSupported.length,
		ecosystemCount: Object.keys(finalEcosystems).length,
		bridgeCount: bridgesWithWatch.length,
		hooksInstalled,
		checksPass
	});
}
//#endregion
export { runInit };

//# sourceMappingURL=init-ChNlgDxr.js.map