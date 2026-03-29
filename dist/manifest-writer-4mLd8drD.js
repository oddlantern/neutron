#!/usr/bin/env node
import { r as isRecord } from "./version-M9xRTj7S.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { isMap, parseDocument } from "yaml";
//#region src/manifest-writer.ts
const DEFAULT_INDENT = "  ";
const DEP_FIELDS_JSON = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies"
];
const packageJsonSchema = z.record(z.string(), z.unknown());
function applyManifestUpdate(root, update) {
	if (update.ecosystem === "dart") return writePubspec(root, update);
	return writePackageJson(root, update);
}
async function writePackageJson(root, update) {
	const filePath = join(root, update.packagePath, "package.json");
	const raw = await readFile(filePath, "utf-8");
	const indent = raw.match(/^(\s+)"/m)?.[1] ?? DEFAULT_INDENT;
	const manifest = packageJsonSchema.parse(JSON.parse(raw));
	let found = false;
	for (const field of DEP_FIELDS_JSON) {
		const deps = manifest[field];
		if (!isRecord(deps)) continue;
		if (!(update.depName in deps)) continue;
		deps[update.depName] = update.newRange;
		found = true;
	}
	if (!found) return false;
	await writeFile(filePath, JSON.stringify(manifest, null, indent) + "\n", "utf-8");
	return true;
}
async function writePubspec(root, update) {
	const filePath = join(root, update.packagePath, "pubspec.yaml");
	const doc = parseDocument(await readFile(filePath, "utf-8"));
	const depFields = [
		"dependencies",
		"dev_dependencies",
		"dependency_overrides"
	];
	let found = false;
	for (const field of depFields) {
		const section = doc.get(field, true);
		if (!isMap(section)) continue;
		if (!section.has(update.depName)) continue;
		const currentValue = section.get(update.depName);
		if (typeof currentValue === "string" || typeof currentValue === "number" || !currentValue) {
			section.set(update.depName, update.newRange);
			found = true;
		} else if (isMap(currentValue)) {
			if (currentValue.has("version")) {
				currentValue.set("version", update.newRange);
				found = true;
			} else if (currentValue.has("path") || currentValue.has("git") || currentValue.has("sdk")) return false;
		}
	}
	if (!found) return false;
	await writeFile(filePath, doc.toString(), "utf-8");
	return true;
}
//#endregion
export { applyManifestUpdate as t };

//# sourceMappingURL=manifest-writer-4mLd8drD.js.map