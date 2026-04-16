import { i as DISPLAY_NAME, t as BINARY_NAME } from "./branding-BIVXTc9K.js";
import { r as HOOK_NAMES } from "./schema-BipwgjSu.js";
import { t as confirmAction } from "./prompt-DoUcLmFP.js";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
//#region src/hooks.ts
const HOOKS_DIR = ".git/hooks";
const HOOK_HEADER = `#!/usr/bin/env sh\n# ${DISPLAY_NAME} — do not edit (regenerate with: ${BINARY_NAME} install)\n`;
const CHECK_DRIFT_HOOK = `${BINARY_NAME} check --quiet || echo "⚠ ${BINARY_NAME}: workspace drift detected — run ${BINARY_NAME} check --fix"`;
const DEFAULT_HOOKS = {
	"pre-commit": [`${BINARY_NAME} pre-commit`],
	"commit-msg": [`${BINARY_NAME} commit-msg "$1"`],
	"post-merge": [CHECK_DRIFT_HOOK],
	"post-checkout": [CHECK_DRIFT_HOOK]
};
/**
* Merge user hooks config with defaults.
* - Omitted hooks section = all defaults
* - Omitted hook key = that hook's default
* - `false` = disabled
* - Array = custom steps
*/
function resolveHooks(config) {
	const userHooks = config?.hooks;
	return HOOK_NAMES.map((name) => {
		const userValue = userHooks?.[name];
		if (userValue === false) return {
			name,
			steps: false
		};
		if (userValue) return {
			name,
			steps: userValue
		};
		return {
			name,
			steps: DEFAULT_HOOKS[name] ?? []
		};
	});
}
function generateScript(name, steps) {
	if (name === "post-checkout") return `${HOOK_HEADER}# Only on branch checkout, not file checkout\nif [ "$3" = "1" ]; then\n  set -e\n${steps.map((s) => `  ${s}`).join("\n")}\nfi\n`;
	return `${HOOK_HEADER}set -e\n${steps.join("\n")}\n`;
}
/**
* Write hook scripts to .git/hooks/ based on resolved config.
*
* @param interactive - When true, prompts before overwriting non-neutron hooks.
*                      When false (watcher context), skips non-neutron hooks silently.
*/
async function writeHooks(root, config, interactive = true) {
	const hooksDir = join(root, HOOKS_DIR);
	if (!existsSync(hooksDir)) await mkdir(hooksDir, { recursive: true });
	const resolved = resolveHooks(config);
	let installed = 0;
	let disabled = 0;
	for (const hook of resolved) {
		const hookPath = join(hooksDir, hook.name);
		if (hook.steps === false) {
			if (existsSync(hookPath)) {
				if ((await readFile(hookPath, "utf-8")).includes("neutron")) {
					await unlink(hookPath);
					disabled++;
				}
			}
			continue;
		}
		const script = generateScript(hook.name, hook.steps);
		if (existsSync(hookPath)) {
			if ((await readFile(hookPath, "utf-8")).includes("neutron")) {
				await writeFile(hookPath, script, "utf-8");
				await chmod(hookPath, 493);
				installed++;
				continue;
			}
			if (!interactive) continue;
			if (!await confirmAction(`Existing ${hook.name} hook found (not owned by neutron). Overwrite?`, false)) {
				console.log(`  skipped ${hook.name}`);
				continue;
			}
		}
		await writeFile(hookPath, script, "utf-8");
		await chmod(hookPath, 493);
		installed++;
	}
	return {
		installed,
		disabled
	};
}
//#endregion
export { writeHooks as t };

//# sourceMappingURL=hooks-N_hTu9l-.js.map