#!/usr/bin/env node
import { n as VERSION, r as isRecord } from "./version-M9xRTj7S.js";
import { l as RED, r as DIM, s as ORANGE, u as RESET } from "./output-MbJ98jNX.js";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { parse } from "yaml";
//#region src/parsers/package-json.ts
const DEP_FIELDS$1 = [
	["dependencies", "production"],
	["devDependencies", "dev"],
	["peerDependencies", "peer"],
	["optionalDependencies", "optional"]
];
const manifestSchema$1 = z.record(z.string(), z.unknown());
function extractDeps$1(manifest, field, type) {
	const raw = manifest[field];
	if (!isRecord(raw)) return [];
	return Object.entries(raw).filter((entry) => typeof entry[1] === "string").map(([name, range]) => ({
		name,
		range,
		type
	}));
}
function extractLocalPaths$1(manifest, manifestDir) {
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
			dependencies: DEP_FIELDS$1.flatMap(([field, type]) => extractDeps$1(manifest, field, type)),
			localDependencyPaths: extractLocalPaths$1(manifest, dirname(manifestPath))
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
function extractDeps(manifest, field, type) {
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
function extractLocalPaths(manifest, manifestDir) {
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
			dependencies: DEP_FIELDS.flatMap(([field, type]) => extractDeps(manifest, field, type)),
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
const parsers = new Map([[packageJsonParser.manifestName, packageJsonParser], [pubspecParser.manifestName, pubspecParser]]);
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
  check [--fix]     Version consistency, bridge validation, env parity
  doctor            Diagnostic: config, hooks, tools, generated output
  outdated          Check for newer dependency versions
  why <dep>         Show which packages use a dependency
  graph             Interactive D3.js dependency graph (--dot, --ascii)

CI / automation:
  ci                Full pipeline: generate → build → lint → test → check
  affected          Packages affected by changes (--base <ref>, --json)
  pre-commit        Format check + lint + workspace check
  commit-msg <file> Validate conventional commit message

Common flags:
  --quiet              Only show failures
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
		const { runAffected } = await import("./affected-1H_7z3JH.js");
		const exitCode = await runAffected(parsers, {
			base,
			json
		});
		process.exit(exitCode);
	}
	if (command === "check") {
		const fix = args.includes("--fix");
		const quiet = args.includes("--quiet") || args.includes("--hook");
		const { runCheck } = await import("./check-Bny1gMPh.js").then((n) => n.t);
		const exitCode = await runCheck(parsers, {
			fix,
			quiet
		});
		process.exit(exitCode);
	}
	if (command === "add") {
		const { runAdd } = await import("./add-BS3f25O-.js");
		const exitCode = await runAdd();
		process.exit(exitCode);
	}
	if (command === "init") {
		const { runInit } = await import("./init-D-4uh_Ul.js");
		const exitCode = await runInit(process.cwd(), parsers);
		process.exit(exitCode);
	}
	if (command === "graph") {
		const format = args.includes("--dot") ? "dot" : args.includes("--ascii") ? "ascii" : "html";
		const noOpen = args.includes("--no-open");
		const { runGraph } = await import("./graph-DSby1cZj.js");
		const exitCode = await runGraph(parsers, {
			format,
			open: !noOpen
		});
		process.exit(exitCode);
	}
	if (command === "doctor") {
		const { runDoctor } = await import("./doctor-sAV3DNtz.js");
		const exitCode = await runDoctor(parsers);
		process.exit(exitCode);
	}
	if (command === "dev") {
		const verbose = args.includes("--verbose");
		const { runDev } = await import("./dev-QOElnOHx.js");
		const exitCode = await runDev(parsers, { verbose });
		process.exit(exitCode);
	}
	if (command === "install") {
		const { runInstall } = await import("./install-C-rEgKHD.js");
		const exitCode = await runInstall(process.cwd());
		process.exit(exitCode);
	}
	if (command === "lint") {
		const fix = args.includes("--fix");
		const quiet = args.includes("--quiet");
		const pkg = getFlagValue(args, "--package");
		const ecosystem = getFlagValue(args, "--ecosystem");
		const { runLint } = await import("./lint-Clcqum0G.js");
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
		const { runFmt } = await import("./fmt-DsUZ_Z94.js");
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
		const { runGenerate } = await import("./generate-BtTDiaAf.js");
		const exitCode = await runGenerate(parsers, {
			quiet,
			verbose,
			force
		});
		process.exit(exitCode);
	}
	if (command === "outdated") {
		const json = args.includes("--json");
		const { runOutdated } = await import("./outdated-Cfa4MzAn.js");
		const exitCode = await runOutdated(parsers, { json });
		process.exit(exitCode);
	}
	if (command === "test") {
		const quiet = args.includes("--quiet");
		const pkg = getFlagValue(args, "--package");
		const ecosystem = getFlagValue(args, "--ecosystem");
		const { runTest } = await import("./test-BaEpWTRj.js");
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
		const { runBuild } = await import("./build-DlR5I35e.js");
		const exitCode = await runBuild(parsers, {
			quiet,
			all,
			package: pkg
		});
		process.exit(exitCode);
	}
	if (command === "ci") {
		const verbose = args.includes("--verbose");
		const { runCi } = await import("./ci-CbJR5pxZ.js");
		const exitCode = await runCi(parsers, { verbose });
		process.exit(exitCode);
	}
	if (command === "pre-commit") {
		const { runPreCommit } = await import("./pre-commit-B7bp3Gk2.js");
		const exitCode = await runPreCommit(parsers);
		process.exit(exitCode);
	}
	if (command === "commit-msg") {
		const filePath = args[1];
		if (!filePath) {
			console.error("Usage: mido commit-msg <file>");
			process.exit(1);
		}
		const { runCommitMsg } = await import("./commit-msg-D9mHgBsX.js");
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
		const { runWhy } = await import("./why-D592jZga.js");
		const exitCode = await runWhy(parsers, depName, { json });
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