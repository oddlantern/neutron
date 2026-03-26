#!/usr/bin/env node
import { join } from "node:path";
import { existsSync } from "node:fs";
//#region src/watcher/pm-detect.ts
const LOCKFILE_TO_PM = new Map([
	["bun.lock", "bun"],
	["bun.lockb", "bun"],
	["pnpm-lock.yaml", "pnpm"],
	["yarn.lock", "yarn"],
	["package-lock.json", "npm"]
]);
/** Detect package manager from lockfiles in the workspace root */
function detectPackageManager(root) {
	for (const [lockfile, pm] of LOCKFILE_TO_PM) if (existsSync(join(root, lockfile))) return pm;
	return "npm";
}
//#endregion
export { detectPackageManager as t };

//# sourceMappingURL=pm-detect-DB_So8gt.js.map