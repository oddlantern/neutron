#!/usr/bin/env node
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
//#region src/version.ts
/** Absolute path to the mido package root directory. */
const MIDO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = join(MIDO_ROOT, "package.json");
const raw = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function extractVersion(data) {
	if (!isRecord(data)) return "0.0.0";
	return typeof data["version"] === "string" ? data["version"] : "0.0.0";
}
const VERSION = extractVersion(raw);
//#endregion
export { VERSION as n, MIDO_ROOT as t };

//# sourceMappingURL=version-TAjFEXRG.js.map