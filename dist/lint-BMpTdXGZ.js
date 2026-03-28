#!/usr/bin/env node
import { r as STANDARD_ACTIONS } from "./registry-Cexd6R4L.js";
import { t as runEcosystemCommand } from "./ecosystem-runner-UJy08Dag.js";
//#region src/commands/lint.ts
/**
* Run linters across all packages in the workspace.
*
* @returns exit code (0 = no errors, 1 = errors found)
*/
async function runLint(parsers, options = {}) {
	const { fix = false, ...rest } = options;
	return runEcosystemCommand(parsers, rest, {
		action: fix ? STANDARD_ACTIONS.LINT_FIX : STANDARD_ACTIONS.LINT,
		ignoreSource: "lint",
		summary: ["All package(s) clean", "Lint errors found"]
	});
}
//#endregion
export { runLint };

//# sourceMappingURL=lint-BMpTdXGZ.js.map