#!/usr/bin/env node
import { t as __exportAll } from "./rolldown-runtime-QdrSlVMC.js";
import { n as VERSION } from "./version-M9xRTj7S.js";
import { f as YELLOW, r as DIM, t as BOLD, u as RESET } from "./output-MbJ98jNX.js";
import { r as configSchema } from "./schema-CCJoTuvI.js";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isMap, isPair, isScalar, isSeq, parse, parseDocument } from "yaml";
import { existsSync } from "node:fs";
//#region src/config/loader.ts
var loader_exports = /* @__PURE__ */ __exportAll({ loadConfig: () => loadConfig });
const CONFIG_FILENAMES = ["mido.yml", "mido.yaml"];
/**
* Walk upward from `startDir` until we find a mido.yml/mido.yaml.
* Returns the absolute path to the config file, or null if not found.
*/
function findConfigFile(startDir) {
	let current = startDir;
	while (true) {
		for (const filename of CONFIG_FILENAMES) {
			const candidate = join(current, filename);
			if (existsSync(candidate)) return candidate;
		}
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}
/** Parse "major.minor.patch" into a numeric tuple. Returns [0,0,0] on failure. */
function parseSemver(version) {
	const [maj, min, pat] = version.split(".").map(Number);
	if (maj === void 0 || min === void 0 || pat === void 0) return [
		0,
		0,
		0
	];
	if (Number.isNaN(maj) || Number.isNaN(min) || Number.isNaN(pat)) return [
		0,
		0,
		0
	];
	return [
		maj,
		min,
		pat
	];
}
/** True when `a >= b` using semver precedence. */
function semverGte(a, b) {
	const [aMaj, aMin, aPat] = parseSemver(a);
	const [bMaj, bMin, bPat] = parseSemver(b);
	if (aMaj !== bMaj) return aMaj > bMaj;
	if (aMin !== bMin) return aMin > bMin;
	return aPat >= bPat;
}
/** v0.0.2 → v0.0.3: Bridge fields from/to/via → source/target/artifact */
const BRIDGE_FIELD_RENAMES = new Map([
	["from", "source"],
	["to", "target"],
	["via", "artifact"]
]);
function migrateBridgeFields(doc) {
	let changed = false;
	const bridges = doc.get("bridges", true);
	if (!isSeq(bridges)) return false;
	for (const item of bridges.items) {
		if (!isMap(item)) continue;
		for (const [oldKey, newKey] of BRIDGE_FIELD_RENAMES) if (item.has(oldKey)) {
			const value = item.get(oldKey);
			item.delete(oldKey);
			item.set(newKey, value);
			changed = true;
		}
	}
	return changed;
}
/**
* v0.0.31 → v0.0.32: Flat lint/format → ecosystem-centric
*
* Old format:
*   lint:
*     rules: { eqeqeq: "warn" }
*     ignore: ["dist"]
*   format:
*     singleQuote: true
*     ignore: ["dist"]
*
* New format:
*   lint:
*     ignore: ["dist"]
*     typescript:
*       rules: { eqeqeq: "warn" }
*   format:
*     ignore: ["dist"]
*     typescript:
*       singleQuote: true
*/
function migrateFlatLintFormat(doc) {
	let changed = false;
	const lint = doc.get("lint", true);
	if (isMap(lint)) {
		if (lint.has("rules") && !lint.has("typescript")) {
			const rules = lint.get("rules");
			lint.delete("rules");
			const tsNode = doc.createNode({ rules });
			lint.set("typescript", tsNode);
			changed = true;
		}
	}
	const format = doc.get("format", true);
	if (isMap(format)) {
		const ECOSYSTEM_KEYS = new Set([
			"ignore",
			"typescript",
			"dart"
		]);
		const formatKeys = [];
		for (const pair of format.items) {
			if (!isPair(pair) || !isScalar(pair.key)) continue;
			const key = String(pair.key.value);
			if (!ECOSYSTEM_KEYS.has(key)) formatKeys.push(key);
		}
		if (formatKeys.length > 0 && !format.has("typescript")) {
			const tsObj = {};
			for (const key of formatKeys) {
				tsObj[key] = format.get(key);
				format.delete(key);
			}
			const tsNode = doc.createNode(tsObj);
			format.set("typescript", tsNode);
			changed = true;
		}
	}
	if (isMap(lint) && lint.has("commits") && !doc.has("commits")) {
		const commits = lint.get("commits", true);
		lint.delete("commits");
		doc.set("commits", commits);
		changed = true;
	}
	return changed;
}
/** v0.4.0 → v0.5.0: Bridge target → consumers array */
function migrateBridgeTarget(doc) {
	let changed = false;
	const bridges = doc.get("bridges", true);
	if (!isSeq(bridges)) return false;
	for (const item of bridges.items) {
		if (!isMap(item)) continue;
		if (item.has("target") && !item.has("consumers")) {
			const target = item.get("target");
			if (isScalar(target) && typeof target.value === "string") {
				item.set("consumers", [target.value]);
				item.delete("target");
				changed = true;
			}
		}
	}
	return changed;
}
/** All migrations in order. Each is idempotent. */
const MIGRATIONS = [
	{
		label: "bridge fields from/to/via → source/target/artifact",
		run: migrateBridgeFields,
		deprecatedAt: "0.0.3",
		removedAt: "999.0.0"
	},
	{
		label: "flat lint/format → ecosystem-centric",
		run: migrateFlatLintFormat,
		deprecatedAt: "0.0.32",
		removedAt: "999.0.0"
	},
	{
		label: "bridge target → consumers array",
		run: migrateBridgeTarget,
		deprecatedAt: "0.4.0",
		removedAt: "999.0.0"
	}
];
/**
* Run all migrations on a parsed YAML document.
*
* Lifecycle:
*  - If `removedAt` is set and current version >= removedAt, the migration is
*    no longer available. If the old format is detected, throw with instructions
*    to migrate manually.
*  - Otherwise, auto-migrate and emit a deprecation warning with the removal version.
*/
function runMigrations(doc) {
	const applied = [];
	const warnings = [];
	for (const migration of MIGRATIONS) {
		if (semverGte(VERSION, migration.removedAt)) {
			const probe = doc.clone();
			if (migration.run(probe)) throw new Error(`mido.yml uses a config format that was removed in v${migration.removedAt}: ${migration.label}\n\nAuto-migration is no longer available. Please update your mido.yml manually.\nIf you're upgrading from a much older version, first install mido@${previousMinor(migration.removedAt)} which still auto-migrates, then upgrade to the latest.`);
			continue;
		}
		if (migration.run(doc)) {
			applied.push(migration.label);
			warnings.push(`${YELLOW}⚠${RESET} ${BOLD}Deprecated config format:${RESET} ${migration.label}. Auto-migration will be removed in v${migration.removedAt}.\n  ${DIM}Your mido.yml has been auto-migrated. Please review the changes.${RESET}`);
		}
	}
	return {
		applied,
		warnings
	};
}
/** Given "1.0.0", return "0.x" as a hint for the intermediate version to install. */
function previousMinor(version) {
	const [major, minor] = parseSemver(version);
	if (minor > 0) return `${major}.${minor - 1}`;
	if (major > 0) return `${major - 1}`;
	return "latest";
}
/**
* Detect and migrate old config formats in place.
* Uses parseDocument to preserve YAML formatting and comments.
*
* @returns migration result with applied labels and final content
*/
async function migrateConfig(configPath, raw) {
	const doc = parseDocument(raw);
	const { applied, warnings } = runMigrations(doc);
	for (const warning of warnings) console.error(warning);
	if (applied.length > 0) {
		const newContent = doc.toString();
		await writeFile(configPath, newContent, "utf-8");
		for (const label of applied) console.log(`migrated mido.yml: ${label}`);
		return {
			applied,
			content: newContent
		};
	}
	return {
		applied: [],
		content: raw
	};
}
/**
* Locate and parse the mido config file.
* Searches upward from the given directory (defaults to cwd).
*
* @throws {Error} if no config file is found or validation fails
*/
async function loadConfig(startDir) {
	const searchFrom = startDir ?? process.cwd();
	const configPath = findConfigFile(searchFrom);
	if (!configPath) throw new Error(`No mido.yml found. Searched upward from ${searchFrom}\nCreate a mido.yml in your workspace root, or run "mido init" to generate one.`);
	let raw = await readFile(configPath, "utf-8");
	raw = (await migrateConfig(configPath, raw)).content;
	let parsed;
	try {
		parsed = parse(raw);
	} catch (cause) {
		throw new Error(`Invalid YAML in ${configPath}`, { cause });
	}
	const result = configSchema.safeParse(parsed);
	if (!result.success) {
		const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
		throw new Error(`Invalid mido config at ${configPath}:\n${issues}`);
	}
	const root = dirname(configPath);
	return {
		config: result.data,
		root,
		configPath
	};
}
//#endregion
export { loader_exports as n, loadConfig as t };

//# sourceMappingURL=loader-KI-fjymk.js.map