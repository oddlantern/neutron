#!/usr/bin/env node
import { r as STANDARD_ACTIONS } from "./registry-CkoeCZGV.js";
import { t as runEcosystemCommand } from "./ecosystem-runner-u3NJn4Z5.js";
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
		ignoreSource: "lint"
	});
}
//#endregion
export { runLint };

//# sourceMappingURL=lint-BTbO1uBU.js.map