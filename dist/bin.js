#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
//#region src/parsers/package-json.ts
const DEP_FIELDS$1 = [
	["dependencies", "production"],
	["devDependencies", "dev"],
	["peerDependencies", "peer"],
	["optionalDependencies", "optional"]
];
function extractDeps$1(manifest, field, type) {
	const raw = manifest[field];
	if (raw === null || raw === void 0 || typeof raw !== "object") return [];
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
		if (raw === null || raw === void 0 || typeof raw !== "object") continue;
		const record = raw;
		for (const value of Object.values(record)) {
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
		const manifest = JSON.parse(content);
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
/**
* Dart dependency values can be:
* - A string version constraint: "^1.2.3"
* - A map with path/git/hosted source: { path: ../shared }
* - null (meaning "any")
*/
function extractDeps(manifest, field, type) {
	const raw = manifest[field];
	if (raw === null || raw === void 0 || typeof raw !== "object") return [];
	const record = raw;
	const deps = [];
	for (const [name, value] of Object.entries(record)) if (typeof value === "string") deps.push({
		name,
		range: value,
		type
	});
	else if (value === null || value === void 0) deps.push({
		name,
		range: "any",
		type
	});
	else if (typeof value === "object") {
		const depMap = value;
		if (typeof depMap["version"] === "string") deps.push({
			name,
			range: depMap["version"],
			type
		});
		else if ("path" in depMap || "git" in depMap || "sdk" in depMap) deps.push({
			name,
			range: "<local>",
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
function extractLocalPaths(manifest, manifestDir) {
	const paths = [];
	for (const [field] of DEP_FIELDS) {
		const raw = manifest[field];
		if (raw === null || raw === void 0 || typeof raw !== "object") continue;
		const record = raw;
		for (const value of Object.values(record)) {
			if (value === null || value === void 0 || typeof value !== "object") continue;
			const depMap = value;
			if (typeof depMap["path"] === "string") paths.push(resolve(manifestDir, depMap["path"]));
		}
	}
	return paths;
}
const pubspecParser = {
	manifestName: "pubspec.yaml",
	async parse(manifestPath) {
		const manifest = parse(await readFile(manifestPath, "utf-8"));
		return {
			name: typeof manifest["name"] === "string" ? manifest["name"] : "<unnamed>",
			version: typeof manifest["version"] === "string" ? manifest["version"] : void 0,
			dependencies: DEP_FIELDS.flatMap(([field, type]) => extractDeps(manifest, field, type)),
			localDependencyPaths: extractLocalPaths(manifest, dirname(manifestPath))
		};
	}
};
//#endregion
//#region src/bin.ts
const parsers = new Map([[packageJsonParser.manifestName, packageJsonParser], [pubspecParser.manifestName, pubspecParser]]);
const HELP = `
mido — cross-ecosystem monorepo workspace tool

Usage:
  mido <command> [options]

Commands:
  check    Run all workspace consistency checks
  help     Show this help message

Options:
  --help, -h       Show help
  --version, -v    Show version
`;
const VERSION = "0.0.1";
async function main() {
	const command = process.argv.slice(2)[0];
	if (command === void 0 || command === "help" || command === "--help" || command === "-h") {
		console.log(HELP);
		process.exit(0);
	}
	if (command === "--version" || command === "-v") {
		console.log(VERSION);
		process.exit(0);
	}
	if (command === "check") {
		const { runCheck } = await import("./check-zfuGgETa.js");
		const exitCode = await runCheck(parsers);
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
export {};

//# sourceMappingURL=bin.js.map