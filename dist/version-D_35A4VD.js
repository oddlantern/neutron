import { t as isRecord } from "./guards-VZ6Ej8Ob.js";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
//#region src/version.ts
/** Absolute path to the neutron package root directory. */
const NEUTRON_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = join(NEUTRON_ROOT, "package.json");
const raw = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
function extractVersion(data) {
	if (!isRecord(data)) return "0.0.0";
	return typeof data["version"] === "string" ? data["version"] : "0.0.0";
}
const VERSION = extractVersion(raw);
//#endregion
export { VERSION as n, NEUTRON_ROOT as t };

//# sourceMappingURL=version-D_35A4VD.js.map