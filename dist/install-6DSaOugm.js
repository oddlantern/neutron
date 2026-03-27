#!/usr/bin/env node
import { n as HOOK_NAMES } from "./schema-BABfk3f4.js";
import { t as confirmAction } from "./prompt-Uoqbqe-z.js";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
//#region src/commands/install.ts
const HOOKS_DIR = ".git/hooks";
const MIDO_MARKER = "mido";
const HOOK_HEADER = `#!/usr/bin/env sh\n# mido — do not edit (regenerate with: mido install)\n`;
const DEFAULT_HOOKS = {
	"pre-commit": ["mido pre-commit"],
	"commit-msg": ["mido commit-msg \"$1\""],
	"post-merge": ["mido check --quiet || echo \"⚠ mido: workspace drift detected — run mido check --fix\""],
	"post-checkout": ["mido check --quiet || echo \"⚠ mido: workspace drift detected — run mido check --fix\""]
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
* @param interactive - When true, prompts before overwriting non-mido hooks.
*                      When false (watcher context), skips non-mido hooks silently.
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
				if ((await readFile(hookPath, "utf-8")).includes(MIDO_MARKER)) {
					await unlink(hookPath);
					disabled++;
				}
			}
			continue;
		}
		const script = generateScript(hook.name, hook.steps);
		if (existsSync(hookPath)) {
			if ((await readFile(hookPath, "utf-8")).includes(MIDO_MARKER)) {
				await writeFile(hookPath, script, "utf-8");
				await chmod(hookPath, 493);
				installed++;
				continue;
			}
			if (!interactive) continue;
			if (!await confirmAction(`Existing ${hook.name} hook found (not owned by mido). Overwrite?`, false)) {
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
/**
* Install git hooks to .git/hooks/. Idempotent — safe to run multiple times.
*
* @returns exit code (0 = success, 1 = error)
*/
async function runInstall(root, config) {
	if (!existsSync(join(root, ".git"))) {
		console.error("Not a git repository. Run \"git init\" first.");
		return 1;
	}
	const { installed, disabled } = await writeHooks(root, config, true);
	const parts = [];
	if (installed > 0) parts.push(`${installed} installed`);
	if (disabled > 0) parts.push(`${disabled} disabled`);
	if (parts.length > 0) console.log(`Git hooks: ${parts.join(", ")}`);
	else console.log("Git hooks: no changes");
	return 0;
}
//#endregion
export { runInstall, writeHooks };

//# sourceMappingURL=install-6DSaOugm.js.map