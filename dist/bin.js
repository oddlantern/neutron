#!/usr/bin/env node
import { n as VERSION, r as isRecord } from "./version-M9xRTj7S.js";
import { l as RED, r as DIM, s as ORANGE, u as RESET } from "./output-MbJ98jNX.js";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { parse } from "yaml";
import { parse as parse$1 } from "smol-toml";
//#region src/parsers/package-json.ts
const DEP_FIELDS$1 = [
	["dependencies", "production"],
	["devDependencies", "dev"],
	["peerDependencies", "peer"],
	["optionalDependencies", "optional"]
];
const manifestSchema$1 = z.record(z.string(), z.unknown());
function extractDeps$3(manifest, field, type) {
	const raw = manifest[field];
	if (!isRecord(raw)) return [];
	return Object.entries(raw).filter((entry) => typeof entry[1] === "string").map(([name, range]) => ({
		name,
		range,
		type
	}));
}
function extractLocalPaths$4(manifest, manifestDir) {
	const paths = [];
	for (const [field] of DEP_FIELDS$1) {
		const raw = manifest[field];
		if (!isRecord(raw)) continue;
		for (const value of Object.values(raw)) {
			if (typeof value !== "string") continue;
			if (value.startsWith("file:")) paths.push(resolve(manifestDir, value.slice(5)));
			else if (value.startsWith("link:")) paths.push(resolve(manifestDir, value.slice(5)));
		}
	}
	return paths;
}
const packageJsonParser = {
	manifestName: "package.json",
	async parse(manifestPath) {
		const content = await readFile(manifestPath, "utf-8");
		const manifest = manifestSchema$1.parse(JSON.parse(content));
		return {
			name: typeof manifest["name"] === "string" ? manifest["name"] : "<unnamed>",
			version: typeof manifest["version"] === "string" ? manifest["version"] : void 0,
			dependencies: DEP_FIELDS$1.flatMap(([field, type]) => extractDeps$3(manifest, field, type)),
			localDependencyPaths: extractLocalPaths$4(manifest, dirname(manifestPath))
		};
	}
};
//#endregion
//#region src/parsers/pubspec.ts
const DEP_FIELDS = [
	["dependencies", "production"],
	["dev_dependencies", "dev"],
	["dependency_overrides", "override"]
];
const manifestSchema = z.record(z.string(), z.unknown());
/**
* Dart dependency values can be:
* - A string version constraint: "^1.2.3"
* - A map with path/git/hosted source: { path: ../shared }
* - null (meaning "any")
*/
function extractDeps$2(manifest, field, type) {
	const raw = manifest[field];
	if (!isRecord(raw)) return [];
	const deps = [];
	for (const [name, value] of Object.entries(raw)) if (typeof value === "string") deps.push({
		name,
		range: value,
		type
	});
	else if (!value) deps.push({
		name,
		range: "any",
		type
	});
	else if (isRecord(value)) if (typeof value["version"] === "string") deps.push({
		name,
		range: value["version"],
		type
	});
	else if ("path" in value || "git" in value || "sdk" in value) deps.push({
		name,
		range: "<local>",
		type
	});
	else deps.push({
		name,
		range: "any",
		type
	});
	return deps;
}
function extractLocalPaths$3(manifest, manifestDir) {
	const paths = [];
	for (const [field] of DEP_FIELDS) {
		const raw = manifest[field];
		if (!isRecord(raw)) continue;
		for (const value of Object.values(raw)) {
			if (!isRecord(value)) continue;
			if (typeof value["path"] === "string") paths.push(resolve(manifestDir, value["path"]));
		}
	}
	return paths;
}
const pubspecParser = {
	manifestName: "pubspec.yaml",
	async parse(manifestPath) {
		const content = await readFile(manifestPath, "utf-8");
		const manifest = manifestSchema.parse(parse(content));
		return {
			name: typeof manifest["name"] === "string" ? manifest["name"] : "<unnamed>",
			version: typeof manifest["version"] === "string" ? manifest["version"] : void 0,
			dependencies: DEP_FIELDS.flatMap(([field, type]) => extractDeps$2(manifest, field, type)),
			localDependencyPaths: extractLocalPaths$3(manifest, dirname(manifestPath))
		};
	}
};
//#endregion
//#region src/parsers/pyproject.ts
/**
* Parse a PEP 508 dependency string (e.g., "requests>=2.28", "click~=8.0").
* Extracts the package name and version specifier.
*/
function parsePep508(spec) {
	const name = spec.match(/^([a-zA-Z0-9][-a-zA-Z0-9_.]*)/)?.[1] ?? spec.trim();
	const afterName = spec.slice(name.length).replace(/\[[^\]]*\]/, "").trim();
	return {
		name,
		range: afterName.startsWith("@") ? "<local>" : afterName || "any"
	};
}
/**
* Extract dependencies from PEP 621 `[project].dependencies` format.
* Each entry is a PEP 508 string.
*/
function extractPep621Deps(project, field, type) {
	const raw = project[field];
	if (!Array.isArray(raw)) return [];
	return raw.filter((item) => typeof item === "string").map((spec) => {
		const { name, range } = parsePep508(spec);
		return {
			name,
			range,
			type
		};
	});
}
/**
* Extract dependencies from PEP 621 `[project].optional-dependencies` format.
*/
function extractOptionalDeps(project) {
	const groups = project["optional-dependencies"];
	if (!isRecord(groups)) return [];
	const deps = [];
	for (const entries of Object.values(groups)) {
		if (!Array.isArray(entries)) continue;
		for (const spec of entries) {
			if (typeof spec !== "string") continue;
			const { name, range } = parsePep508(spec);
			deps.push({
				name,
				range,
				type: "optional"
			});
		}
	}
	return deps;
}
/**
* Extract dependencies from Poetry `[tool.poetry.dependencies]` format.
* Values are either version strings ("^1.2") or tables ({ version = "^1.2", ... }).
*/
function extractPoetryDeps(manifest, field, type) {
	const tool = isRecord(manifest["tool"]) ? manifest["tool"] : null;
	const poetry = tool && isRecord(tool["poetry"]) ? tool["poetry"] : null;
	if (!poetry) return [];
	const raw = poetry[field];
	if (!isRecord(raw)) return [];
	const deps = [];
	for (const [name, value] of Object.entries(raw)) {
		if (name === "python") continue;
		if (typeof value === "string") deps.push({
			name,
			range: value,
			type
		});
		else if (isRecord(value)) if (typeof value["path"] === "string") deps.push({
			name,
			range: "<local>",
			type
		});
		else if (typeof value["version"] === "string") deps.push({
			name,
			range: value["version"],
			type
		});
		else deps.push({
			name,
			range: "any",
			type
		});
	}
	return deps;
}
/**
* Extract local dependency paths from Poetry path deps and PEP 508 file: references.
*/
function extractLocalPaths$2(manifest, project, manifestDir) {
	const paths = [];
	const tool = isRecord(manifest["tool"]) ? manifest["tool"] : null;
	const poetry = tool && isRecord(tool["poetry"]) ? tool["poetry"] : null;
	if (poetry) for (const field of ["dependencies", "dev-dependencies"]) {
		const raw = poetry[field];
		if (!isRecord(raw)) continue;
		for (const value of Object.values(raw)) if (isRecord(value) && typeof value["path"] === "string") paths.push(resolve(manifestDir, value["path"]));
	}
	if (project) {
		const deps = project["dependencies"];
		if (Array.isArray(deps)) for (const spec of deps) {
			if (typeof spec !== "string") continue;
			const fileMatch = spec.match(/@\s*file:(.+)/);
			if (fileMatch?.[1]) paths.push(resolve(manifestDir, fileMatch[1].trim()));
		}
	}
	return paths;
}
const pyprojectParser = {
	manifestName: "pyproject.toml",
	async parse(manifestPath) {
		const manifest = parse$1(await readFile(manifestPath, "utf-8"));
		const project = isRecord(manifest["project"]) ? manifest["project"] : null;
		const tool = isRecord(manifest["tool"]) ? manifest["tool"] : null;
		const poetry = tool && isRecord(tool["poetry"]) ? tool["poetry"] : null;
		const name = (project && typeof project["name"] === "string" ? project["name"] : null) ?? (poetry && typeof poetry["name"] === "string" ? poetry["name"] : null) ?? "<unnamed>";
		const version = (project && typeof project["version"] === "string" ? project["version"] : null) ?? (poetry && typeof poetry["version"] === "string" ? poetry["version"] : null) ?? void 0;
		let dependencies;
		if (project && Array.isArray(project["dependencies"])) dependencies = [...extractPep621Deps(project, "dependencies", "production"), ...extractOptionalDeps(project)];
		else if (poetry) dependencies = [...extractPoetryDeps(manifest, "dependencies", "production"), ...extractPoetryDeps(manifest, "dev-dependencies", "dev")];
		else dependencies = [];
		const localDependencyPaths = extractLocalPaths$2(manifest, project, dirname(manifestPath));
		return {
			name,
			version,
			dependencies,
			localDependencyPaths
		};
	}
};
//#endregion
//#region src/parsers/cargo.ts
/**
* Extract dependencies from a Cargo.toml dependency section.
*
* Values are either:
* - A string version: `serde = "1.0"`
* - A table with version: `serde = { version = "1.0", features = ["derive"] }`
* - A table with path (local dep): `my-lib = { path = "../shared" }`
*/
function extractDeps$1(manifest, field, type) {
	const raw = manifest[field];
	if (!isRecord(raw)) return [];
	const deps = [];
	for (const [name, value] of Object.entries(raw)) if (typeof value === "string") deps.push({
		name,
		range: value,
		type
	});
	else if (isRecord(value)) if (typeof value["path"] === "string") {
		const range = typeof value["version"] === "string" ? value["version"] : "<local>";
		deps.push({
			name,
			range,
			type
		});
	} else if (typeof value["version"] === "string") deps.push({
		name,
		range: value["version"],
		type
	});
	else if (typeof value["git"] === "string") deps.push({
		name,
		range: "<git>",
		type
	});
	else deps.push({
		name,
		range: "any",
		type
	});
	return deps;
}
/**
* Extract local dependency paths from path deps across all sections.
*/
function extractLocalPaths$1(manifest, manifestDir) {
	const paths = [];
	for (const section of [
		"dependencies",
		"dev-dependencies",
		"build-dependencies"
	]) {
		const raw = manifest[section];
		if (!isRecord(raw)) continue;
		for (const value of Object.values(raw)) if (isRecord(value) && typeof value["path"] === "string") paths.push(resolve(manifestDir, value["path"]));
	}
	return paths;
}
const cargoParser = {
	manifestName: "Cargo.toml",
	async parse(manifestPath) {
		const manifest = parse$1(await readFile(manifestPath, "utf-8"));
		const pkg = isRecord(manifest["package"]) ? manifest["package"] : null;
		return {
			name: pkg && typeof pkg["name"] === "string" ? pkg["name"] : "<unnamed>",
			version: pkg && typeof pkg["version"] === "string" ? pkg["version"] : void 0,
			dependencies: [
				...extractDeps$1(manifest, "dependencies", "production"),
				...extractDeps$1(manifest, "dev-dependencies", "dev"),
				...extractDeps$1(manifest, "build-dependencies", "dev")
			],
			localDependencyPaths: extractLocalPaths$1(manifest, dirname(manifestPath))
		};
	}
};
//#endregion
//#region src/parsers/go-mod.ts
/**
* Parse a go.mod file. Line-based format:
*
* ```
* module github.com/org/my-module
*
* go 1.21
*
* require (
*     github.com/gin-gonic/gin v1.9.1
*     github.com/org/shared v0.0.0
* )
*
* replace github.com/org/shared => ../shared
* ```
*/
/** Parse a single require entry like "github.com/foo/bar v1.2.3" */
function parseRequireLine(line) {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("//")) return null;
	const parts = trimmed.split(/\s+/);
	if (parts.length < 2) return null;
	return {
		name: parts[0],
		range: parts[1]
	};
}
const goModParser = {
	manifestName: "go.mod",
	async parse(manifestPath) {
		const lines = (await readFile(manifestPath, "utf-8")).split("\n");
		let name = "<unnamed>";
		const dependencies = [];
		const localPaths = [];
		const manifestDir = dirname(manifestPath);
		let inRequireBlock = false;
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith("module ")) {
				name = trimmed.slice(7).trim();
				continue;
			}
			if (trimmed.startsWith("require (") || trimmed === "require (") {
				inRequireBlock = true;
				continue;
			}
			if (trimmed === ")" && inRequireBlock) {
				inRequireBlock = false;
				continue;
			}
			if (inRequireBlock) {
				const dep = parseRequireLine(trimmed);
				if (dep) dependencies.push({
					name: dep.name,
					range: dep.range,
					type: "production"
				});
				continue;
			}
			if (trimmed.startsWith("require ") && !trimmed.includes("(")) {
				const dep = parseRequireLine(trimmed.slice(8).trim());
				if (dep) dependencies.push({
					name: dep.name,
					range: dep.range,
					type: "production"
				});
				continue;
			}
			if (trimmed.startsWith("replace ")) {
				const arrowIndex = trimmed.indexOf("=>");
				if (arrowIndex === -1) continue;
				const target = trimmed.slice(arrowIndex + 2).trim();
				if (target.startsWith(".") || target.startsWith("/")) {
					const pathPart = target.split(/\s+/)[0];
					localPaths.push(resolve(manifestDir, pathPart));
				}
			}
		}
		return {
			name,
			version: void 0,
			dependencies,
			localDependencyPaths: localPaths
		};
	}
};
//#endregion
//#region src/parsers/composer.ts
/** Platform requirements that are not actual packages */
function isPlatformRequirement(name) {
	return name === "php" || name.startsWith("ext-") || name.startsWith("lib-") || name === "composer";
}
function extractDeps(manifest, field, type) {
	const raw = manifest[field];
	if (!isRecord(raw)) return [];
	return Object.entries(raw).filter((entry) => typeof entry[1] === "string").filter(([name]) => !isPlatformRequirement(name)).map(([name, range]) => ({
		name,
		range,
		type
	}));
}
/**
* Extract local dependency paths from composer.json repositories.
* Path repositories look like: { "type": "path", "url": "../shared" }
*/
function extractLocalPaths(manifest, manifestDir) {
	const repos = manifest["repositories"];
	if (!Array.isArray(repos)) return [];
	const paths = [];
	for (const repo of repos) {
		if (!isRecord(repo)) continue;
		if (repo["type"] === "path" && typeof repo["url"] === "string") paths.push(resolve(manifestDir, repo["url"]));
	}
	return paths;
}
const composerParser = {
	manifestName: "composer.json",
	async parse(manifestPath) {
		const content = await readFile(manifestPath, "utf-8");
		const manifest = JSON.parse(content);
		if (!isRecord(manifest)) throw new Error(`Expected object in ${manifestPath}`);
		return {
			name: typeof manifest["name"] === "string" ? manifest["name"] : "<unnamed>",
			version: typeof manifest["version"] === "string" ? manifest["version"] : void 0,
			dependencies: [...extractDeps(manifest, "require", "production"), ...extractDeps(manifest, "require-dev", "dev")],
			localDependencyPaths: extractLocalPaths(manifest, dirname(manifestPath))
		};
	}
};
//#endregion
//#region src/banner.ts
const ART = `\
░███     ░███ ░██████░███████     ░██████
░████   ░████   ░██  ░██   ░██   ░██   ░██
░██░██ ░██░██   ░██  ░██    ░██ ░██     ░██
░██ ░████ ░██   ░██  ░██    ░██ ░██     ░██
░██  ░██  ░██   ░██  ░██    ░██ ░██     ░██
░██       ░██   ░██  ░██   ░██   ░██   ░██
░██       ░██ ░██████░███████     ░██████`;
const ART_WIDTH = 43;
function printBanner() {
	const versionLine = `v${VERSION}`.padStart(ART_WIDTH);
	const tagLine = "workspace guardian".padStart(Math.floor((ART_WIDTH + 18) / 2));
	console.log(`\n${ORANGE}${ART}${RESET}\n${DIM}${versionLine}\n${tagLine}${RESET}\n`);
}
//#endregion
//#region src/bin.ts
const parsers = new Map([
	[packageJsonParser.manifestName, packageJsonParser],
	[pubspecParser.manifestName, pubspecParser],
	[pyprojectParser.manifestName, pyprojectParser],
	[cargoParser.manifestName, cargoParser],
	[goModParser.manifestName, goModParser],
	[composerParser.manifestName, composerParser]
]);
/** Extract the value following a --flag from the args list */
function getFlagValue(args, flag) {
	const idx = args.indexOf(flag);
	if (idx === -1 || idx + 1 >= args.length) return;
	return args[idx + 1];
}
const HELP = `
mido — cross-ecosystem monorepo workspace tool

Usage:
  mido <command> [options]

Setup:
  init              Scan repo, generate mido.yml, install hooks
  install           Write git hooks to .git/hooks/
  add               Scaffold a new package in the workspace

Development:
  dev [--verbose]   Watch bridges and regenerate on changes
  generate          Run all bridge pipelines (--force to skip cache)
  lint [--fix]      Run linters across all packages
  fmt [--check]     Format all packages
  test              Run tests across all packages
  build [--all]     Build library packages (--all includes apps)

Workspace health:
  rename <name>     Rename workspace (cascades to all manifests)
  check [--fix]     Version consistency, bridge validation, env parity
  doctor            Diagnostic: config, hooks, tools, generated output
  outdated          Check for newer dependency versions (--deep, --verify)
  upgrade           Upgrade outdated dependencies (--all, --verify)
  why <dep>         Show which packages use a dependency
  graph             Interactive D3.js dependency graph (--dot, --ascii)

CI / automation:
  ci                Full pipeline: generate → build → lint → test → check
  affected          Packages affected by changes (--base <ref>, --json)
  pre-commit        Format check + lint + workspace check
  commit-msg <file> Validate conventional commit message

Common flags:
  --quiet              Only show failures
  --dry-run            Preview changes without writing to disk
  --package <path>     Target a specific package
  --ecosystem <name>   Target a specific ecosystem (lint, fmt, test)
  --json               Machine-readable output (affected, outdated, why)

Config:
  mido.yml          Workspace config (searched upward from cwd)
  mido.lock         Resolved version policy (auto-generated by --fix)

Options:
  --help, -h       Show help
  --version, -v    Show version
`;
async function main() {
	const args = process.argv.slice(2);
	const command = args[0];
	if (!command || command === "help" || command === "--help" || command === "-h") {
		printBanner();
		console.log(HELP);
		process.exit(0);
	}
	if (command === "--version" || command === "-v") {
		console.log(VERSION);
		process.exit(0);
	}
	if (command === "affected") {
		const base = getFlagValue(args, "--base");
		const json = args.includes("--json");
		const { runAffected } = await import("./affected-pyBNFu_8.js");
		const exitCode = await runAffected(parsers, {
			base,
			json
		});
		process.exit(exitCode);
	}
	if (command === "check") {
		const fix = args.includes("--fix");
		const quiet = args.includes("--quiet") || args.includes("--hook");
		const { runCheck } = await import("./check-D_eQoQxg.js").then((n) => n.t);
		const exitCode = await runCheck(parsers, {
			fix,
			quiet
		});
		process.exit(exitCode);
	}
	if (command === "add") {
		const { runAdd } = await import("./add-C47daBW5.js");
		const exitCode = await runAdd();
		process.exit(exitCode);
	}
	if (command === "init") {
		const { runInit } = await import("./init-CNjd5Qgi.js");
		const exitCode = await runInit(process.cwd(), parsers);
		process.exit(exitCode);
	}
	if (command === "graph") {
		const format = args.includes("--dot") ? "dot" : args.includes("--ascii") ? "ascii" : "html";
		const noOpen = args.includes("--no-open");
		const { runGraph } = await import("./graph-DRpru-oh.js");
		const exitCode = await runGraph(parsers, {
			format,
			open: !noOpen
		});
		process.exit(exitCode);
	}
	if (command === "doctor") {
		const { runDoctor } = await import("./doctor-CPFxQB3M.js");
		const exitCode = await runDoctor(parsers);
		process.exit(exitCode);
	}
	if (command === "dev") {
		const verbose = args.includes("--verbose");
		const { runDev } = await import("./dev-fvbXLcFY.js");
		const exitCode = await runDev(parsers, { verbose });
		process.exit(exitCode);
	}
	if (command === "install") {
		const dryRun = args.includes("--dry-run");
		const { runInstall } = await import("./install-OyNUp_Pd.js");
		const exitCode = await runInstall(process.cwd(), { dryRun }, void 0);
		process.exit(exitCode);
	}
	if (command === "lint") {
		const fix = args.includes("--fix");
		const quiet = args.includes("--quiet");
		const pkg = getFlagValue(args, "--package");
		const ecosystem = getFlagValue(args, "--ecosystem");
		const { runLint } = await import("./lint-BTbO1uBU.js");
		const exitCode = await runLint(parsers, {
			fix,
			quiet,
			package: pkg,
			ecosystem
		});
		process.exit(exitCode);
	}
	if (command === "fmt") {
		const check = args.includes("--check");
		const quiet = args.includes("--quiet");
		const pkg = getFlagValue(args, "--package");
		const ecosystem = getFlagValue(args, "--ecosystem");
		const { runFmt } = await import("./fmt-D7nW2GIl.js");
		const exitCode = await runFmt(parsers, {
			check,
			quiet,
			package: pkg,
			ecosystem
		});
		process.exit(exitCode);
	}
	if (command === "generate") {
		const quiet = args.includes("--quiet");
		const verbose = args.includes("--verbose");
		const force = args.includes("--force");
		const dryRun = args.includes("--dry-run");
		const { runGenerate } = await import("./generate-BgpRFsf7.js");
		const exitCode = await runGenerate(parsers, {
			quiet,
			verbose,
			force,
			dryRun
		});
		process.exit(exitCode);
	}
	if (command === "outdated") {
		const json = args.includes("--json");
		const deep = args.includes("--deep");
		const verify = args.includes("--verify");
		const ci = args.includes("--ci");
		const { runOutdated } = await import("./outdated-DO9vg-Z4.js");
		const exitCode = await runOutdated(parsers, {
			json,
			deep,
			verify,
			ci
		});
		process.exit(exitCode);
	}
	if (command === "upgrade") {
		const all = args.includes("--all");
		const verify = args.includes("--verify");
		const dryRun = args.includes("--dry-run");
		const { runUpgrade } = await import("./upgrade-Bfe9oRN2.js");
		const exitCode = await runUpgrade(parsers, {
			all,
			verify,
			dryRun
		});
		process.exit(exitCode);
	}
	if (command === "test") {
		const quiet = args.includes("--quiet");
		const pkg = getFlagValue(args, "--package");
		const ecosystem = getFlagValue(args, "--ecosystem");
		const { runTest } = await import("./test-Btp3yHxN.js");
		const exitCode = await runTest(parsers, {
			quiet,
			package: pkg,
			ecosystem
		});
		process.exit(exitCode);
	}
	if (command === "build") {
		const quiet = args.includes("--quiet");
		const all = args.includes("--all");
		const pkg = getFlagValue(args, "--package");
		const { runBuild } = await import("./build-gJCiF5J9.js");
		const exitCode = await runBuild(parsers, {
			quiet,
			all,
			package: pkg
		});
		process.exit(exitCode);
	}
	if (command === "ci") {
		const verbose = args.includes("--verbose");
		const { runCi } = await import("./ci-KykoIcY5.js");
		const exitCode = await runCi(parsers, { verbose });
		process.exit(exitCode);
	}
	if (command === "pre-commit") {
		const { runPreCommit } = await import("./pre-commit-CzUg_6Ih.js");
		const exitCode = await runPreCommit(parsers);
		process.exit(exitCode);
	}
	if (command === "commit-msg") {
		const filePath = args[1];
		if (!filePath) {
			console.error("Usage: mido commit-msg <file>");
			process.exit(1);
		}
		const { runCommitMsg } = await import("./commit-msg-G5QqYoit.js");
		const exitCode = await runCommitMsg(filePath);
		process.exit(exitCode);
	}
	if (command === "why") {
		const depName = args[1];
		if (!depName) {
			console.error("Usage: mido why <dependency>");
			process.exit(1);
		}
		const json = args.includes("--json");
		const { runWhy } = await import("./why-B2bdQprd.js");
		const exitCode = await runWhy(parsers, depName, { json });
		process.exit(exitCode);
	}
	if (command === "rename") {
		const newName = args[1];
		if (!newName) {
			console.error("Usage: mido rename <new-name> [--include-platform-ids]");
			process.exit(1);
		}
		const includePlatformIds = args.includes("--include-platform-ids");
		const dryRun = args.includes("--dry-run");
		const { runRename } = await import("./rename-DgVzOR3L.js");
		const exitCode = await runRename(parsers, newName, {
			includePlatformIds,
			dryRun
		});
		process.exit(exitCode);
	}
	if (command === "version" || command === "--v") {
		console.log(VERSION);
		process.exit(0);
	}
	printBanner();
	console.error(`\nUnknown command: "${command}"\n`);
	console.log(HELP);
	process.exit(1);
}
main().catch((error) => {
	if (error instanceof Error && error.name === "CancelError") process.exit(0);
	const message = error instanceof Error ? error.message : String(error);
	console.error(`${RED}error:${RESET} ${message}`);
	process.exit(1);
});
//#endregion
export { printBanner as t };

//# sourceMappingURL=bin.js.map