#!/usr/bin/env node
import { r as closePrompt, t as ask } from "./prompt-IS8nnzAW.js";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
//#region src/commands/install.ts
const HOOKS_DIR = ".git/hooks";
const HOOKS = [
	{
		name: "pre-commit",
		content: `#!/usr/bin/env sh
mido check --quiet
`
	},
	{
		name: "commit-msg",
		content: `#!/usr/bin/env sh
mido commit-msg "$1"
`
	},
	{
		name: "post-merge",
		content: `#!/usr/bin/env sh
mido check --quiet || echo "⚠ mido: workspace drift detected — run mido check --fix"
`
	},
	{
		name: "post-checkout",
		content: `#!/usr/bin/env sh
# Only on branch checkout, not file checkout
if [ "$3" = "1" ]; then
  mido check --quiet || echo "⚠ mido: workspace drift detected — run mido check --fix"
fi
`
	}
];
const MIDO_MARKER = "mido";
/**
* Install git hooks to .git/hooks/. Idempotent — safe to run multiple times.
*
* @returns exit code (0 = success, 1 = error)
*/
async function runInstall(root) {
	if (!existsSync(join(root, ".git"))) {
		console.error("Not a git repository. Run \"git init\" first.");
		return 1;
	}
	const hooksDir = join(root, HOOKS_DIR);
	if (!existsSync(hooksDir)) await mkdir(hooksDir, { recursive: true });
	let installed = 0;
	for (const hook of HOOKS) {
		const hookPath = join(hooksDir, hook.name);
		if (existsSync(hookPath)) {
			if ((await readFile(hookPath, "utf-8")).includes(MIDO_MARKER)) {
				await writeFile(hookPath, hook.content, "utf-8");
				await chmod(hookPath, 493);
				installed++;
				continue;
			}
			console.log(`  existing ${hook.name} hook found (not owned by mido)`);
			if ((await ask(`  Overwrite ${hook.name}? [y/N] `)).toLowerCase() !== "y") {
				console.log(`  skipped ${hook.name}`);
				continue;
			}
		}
		await writeFile(hookPath, hook.content, "utf-8");
		await chmod(hookPath, 493);
		installed++;
	}
	closePrompt();
	console.log(`Installed ${installed} git hook(s)`);
	return 0;
}
//#endregion
export { runInstall };

//# sourceMappingURL=install-cCGe-Me7.js.map