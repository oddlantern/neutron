#!/usr/bin/env node
import { r as isRecord } from "./version-M9xRTj7S.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { isMap, parseDocument } from "yaml";
import { parse as parse$1, stringify as stringify$1 } from "smol-toml";
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
	switch (update.ecosystem) {
		case "dart": return writePubspec(root, update);
		case "python": return writePyproject(root, update);
		case "rust": return writeCargoToml(root, update);
		case "go": return writeGoMod(root, update);
		case "php": return writeComposerJson(root, update);
		default: return writePackageJson(root, update);
	}
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
async function writePyproject(root, update) {
	const filePath = join(root, update.packagePath, "pyproject.toml");
	const doc = parse$1(await readFile(filePath, "utf-8"));
	let found = false;
	const project = isRecord(doc["project"]) ? doc["project"] : null;
	if (project && Array.isArray(project["dependencies"])) {
		const deps = project["dependencies"];
		for (let i = 0; i < deps.length; i++) if ((deps[i]?.match(/^([a-zA-Z0-9][-a-zA-Z0-9_.]*)/))?.[1] === update.depName) {
			deps[i] = `${update.depName}${update.newRange}`;
			found = true;
			break;
		}
	}
	if (!found) {
		const tool = isRecord(doc["tool"]) ? doc["tool"] : null;
		const poetry = tool && isRecord(tool["poetry"]) ? tool["poetry"] : null;
		if (poetry) for (const field of ["dependencies", "dev-dependencies"]) {
			const deps = isRecord(poetry[field]) ? poetry[field] : null;
			if (deps && update.depName in deps) {
				const val = deps[update.depName];
				if (typeof val === "string") deps[update.depName] = update.newRange;
				else if (isRecord(val) && "version" in val) val["version"] = update.newRange;
				found = true;
				break;
			}
		}
	}
	if (!found) return false;
	await writeFile(filePath, stringify$1(doc), "utf-8");
	return true;
}
async function writeCargoToml(root, update) {
	const filePath = join(root, update.packagePath, "Cargo.toml");
	const doc = parse$1(await readFile(filePath, "utf-8"));
	let found = false;
	for (const field of [
		"dependencies",
		"dev-dependencies",
		"build-dependencies"
	]) {
		const deps = isRecord(doc[field]) ? doc[field] : null;
		if (!deps || !(update.depName in deps)) continue;
		const val = deps[update.depName];
		if (typeof val === "string") deps[update.depName] = update.newRange;
		else if (isRecord(val) && "version" in val) val["version"] = update.newRange;
		else continue;
		found = true;
		break;
	}
	if (!found) return false;
	await writeFile(filePath, stringify$1(doc), "utf-8");
	return true;
}
async function writeGoMod(root, update) {
	const filePath = join(root, update.packagePath, "go.mod");
	const lines = (await readFile(filePath, "utf-8")).split("\n");
	let found = false;
	const escaped = update.depName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const requireLineRe = new RegExp(`^(\\s*)${escaped}\\s+\\S+`);
	for (let i = 0; i < lines.length; i++) if (requireLineRe.test(lines[i])) {
		lines[i] = `${lines[i].match(/^(\s*)/)?.[1] ?? "	"}${update.depName} ${update.newRange}`;
		found = true;
		break;
	}
	if (!found) return false;
	await writeFile(filePath, lines.join("\n"), "utf-8");
	return true;
}
async function writeComposerJson(root, update) {
	const filePath = join(root, update.packagePath, "composer.json");
	const raw = await readFile(filePath, "utf-8");
	const indent = raw.match(/^(\s+)"/m)?.[1] ?? DEFAULT_INDENT;
	const manifest = JSON.parse(raw);
	if (!isRecord(manifest)) return false;
	let found = false;
	for (const field of ["require", "require-dev"]) {
		const deps = isRecord(manifest[field]) ? manifest[field] : null;
		if (deps && update.depName in deps) {
			deps[update.depName] = update.newRange;
			found = true;
			break;
		}
	}
	if (!found) return false;
	await writeFile(filePath, JSON.stringify(manifest, null, indent) + "\n", "utf-8");
	return true;
}
//#endregion
export { applyManifestUpdate as t };

//# sourceMappingURL=manifest-writer-Dyv9LyXP.js.map