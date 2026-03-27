#!/usr/bin/env node
import { t as writeHooks } from "./hooks-BkSDCj7v.js";
import { join } from "node:path";
import { existsSync } from "node:fs";
//#region src/commands/install.ts
/**
* Install git hooks to .git/hooks/. Idempotent — safe to run multiple times.
*
* Loads config internally when not provided (e.g., when called from bin.ts).
*
* @returns exit code (0 = success, 1 = error)
*/
async function runInstall(root, config) {
	if (!existsSync(join(root, ".git"))) {
		console.error("Not a git repository. Run \"git init\" first.");
		return 1;
	}
	let resolvedConfig = config;
	if (!resolvedConfig) try {
		const { loadConfig } = await import("./loader-Co8X4jm-.js").then((n) => n.n);
		resolvedConfig = (await loadConfig()).config;
	} catch {}
	const { installed, disabled } = await writeHooks(root, resolvedConfig, true);
	const parts = [];
	if (installed > 0) parts.push(`${installed} installed`);
	if (disabled > 0) parts.push(`${disabled} disabled`);
	if (parts.length > 0) console.log(`Git hooks: ${parts.join(", ")}`);
	else console.log("Git hooks: no changes");
	return 0;
}
//#endregion
export { runInstall };

//# sourceMappingURL=install-BkyvVsbp.js.map