#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { isMap, isSeq, parse, parseDocument } from "yaml";
import { existsSync } from "node:fs";
//#region src/config/schema.ts
const ecosystemSchema = z.object({
	manifest: z.string(),
	lockfile: z.string().optional(),
	packages: z.array(z.string()).min(1)
});
const bridgeSchema = z.object({
	source: z.string(),
	target: z.string(),
	artifact: z.string(),
	run: z.string().optional(),
	watch: z.array(z.string()).optional()
});
const envSchema = z.object({
	shared: z.array(z.string()).min(1),
	files: z.array(z.string()).min(2)
});
const DEFAULT_COMMIT_TYPES = [
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
];
const commitsSchema = z.object({
	types: z.array(z.string()).min(1).default([...DEFAULT_COMMIT_TYPES]),
	scopes: z.array(z.string()).optional(),
	header_max_length: z.number().int().positive().default(100),
	body_max_line_length: z.number().int().positive().default(200)
});
const configSchema = z.object({
	workspace: z.string(),
	ecosystems: z.record(z.string(), ecosystemSchema).refine((eco) => Object.keys(eco).length >= 1, { message: "At least one ecosystem must be defined" }),
	bridges: z.array(bridgeSchema).optional(),
	env: envSchema.optional(),
	commits: commitsSchema.optional()
});
//#endregion
//#region src/config/loader.ts
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
/** Field renames for bridge schema migration (v0.0.2 → v0.0.3) */
const BRIDGE_FIELD_RENAMES = new Map([
	["from", "source"],
	["to", "target"],
	["via", "artifact"]
]);
/**
* Detect and migrate old config formats in place.
* Uses parseDocument to preserve YAML formatting and comments.
*
* @returns true if migration was performed, false if no migration needed
*/
async function migrateConfig(configPath, raw) {
	const doc = parseDocument(raw);
	let migrated = false;
	const bridges = doc.get("bridges", true);
	if (isSeq(bridges)) for (const item of bridges.items) {
		if (!isMap(item)) continue;
		for (const [oldKey, newKey] of BRIDGE_FIELD_RENAMES) if (item.has(oldKey)) {
			const value = item.get(oldKey);
			item.delete(oldKey);
			item.set(newKey, value);
			migrated = true;
		}
	}
	if (migrated) {
		const newContent = doc.toString();
		await writeFile(configPath, newContent, "utf-8");
		console.log("migrated mido.yml to v0.0.3 format.");
		return {
			migrated: true,
			content: newContent
		};
	}
	return {
		migrated: false,
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
export { DEFAULT_COMMIT_TYPES as n, loadConfig as t };

//# sourceMappingURL=loader-DBSgOfQT.js.map