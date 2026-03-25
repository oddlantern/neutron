#!/usr/bin/env node
import { a as ORANGE, r as DIM, s as RESET } from "./output-D1Xg1ws_.js";
import { n as VERSION } from "./version-WDd4fw5u.js";
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
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function extractDeps$1(manifest, field, type) {
	const raw = manifest[field];
	if (!isRecord$1(raw)) return [];
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
		if (!isRecord$1(raw)) continue;
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
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
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

Commands:
  init              Scan repo and generate mido.yml
  install           Install git hooks
  check             Run all workspace consistency checks
  check --fix       Interactively resolve version mismatches and update mido.lock
  check --quiet     Silent mode — only output on failure (for hooks)
  dev [--verbose]   Watch bridges and regenerate on changes
  lint              Run linters across all packages
  lint --fix        Auto-fix lint issues
  fmt               Format all packages
  fmt --check       Check formatting without fixing
  build             Build all packages
  pre-commit        Run full pre-commit validation suite
  commit-msg <file> Validate a commit message (used by git hooks)
  help              Show this help message

Flags (lint, fmt, build):
  --quiet              Only show failures
  --package <path>     Target a specific package

Flags (lint, fmt):
  --ecosystem <name>   Target a specific ecosystem (typescript, dart)

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
	if (command === "check") {
		const fix = args.includes("--fix");
		const quiet = args.includes("--quiet") || args.includes("--hook");
		const { runCheck } = await import("./check-BfVJls7g.js");
		const exitCode = await runCheck(parsers, {
			fix,
			quiet
		});
		process.exit(exitCode);
	}
	if (command === "init") {
		const { runInit } = await import("./init-B1BOxKtY.js");
		const exitCode = await runInit(process.cwd(), parsers);
		process.exit(exitCode);
	}
	if (command === "dev") {
		const verbose = args.includes("--verbose");
		const { runDev } = await import("./dev-BVOsLa7-.js");
		const exitCode = await runDev(parsers, { verbose });
		process.exit(exitCode);
	}
	if (command === "install") {
		const { runInstall } = await import("./install-CbBbjtP1.js");
		const exitCode = await runInstall(process.cwd());
		process.exit(exitCode);
	}
	if (command === "lint") {
		const fix = args.includes("--fix");
		const quiet = args.includes("--quiet");
		const pkg = getFlagValue(args, "--package");
		const ecosystem = getFlagValue(args, "--ecosystem");
		const { runLint } = await import("./lint-CpjAcD5F.js");
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
		const { runFmt } = await import("./fmt-DsYDIO_h.js");
		const exitCode = await runFmt(parsers, {
			check,
			quiet,
			package: pkg,
			ecosystem
		});
		process.exit(exitCode);
	}
	if (command === "build") {
		const quiet = args.includes("--quiet");
		const pkg = getFlagValue(args, "--package");
		const { runBuild } = await import("./build-D0CeuePG.js");
		const exitCode = await runBuild(parsers, {
			quiet,
			package: pkg
		});
		process.exit(exitCode);
	}
	if (command === "pre-commit") {
		const { runPreCommit } = await import("./pre-commit-CU499839.js");
		const exitCode = await runPreCommit(parsers);
		process.exit(exitCode);
	}
	if (command === "commit-msg") {
		const filePath = args[1];
		if (!filePath) {
			console.error("Usage: mido commit-msg <file>");
			process.exit(1);
		}
		const { runCommitMsg } = await import("./commit-msg-Cv_9Qbwu.js");
		const exitCode = await runCommitMsg(filePath);
		process.exit(exitCode);
	}
	console.error(`Unknown command: ${command}\nRun "mido help" for usage.`);
	process.exit(1);
}
main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`\x1b[31merror:\x1b[0m ${message}`);
	process.exit(1);
});
//#endregion
export { printBanner as t };

//# sourceMappingURL=bin.js.map