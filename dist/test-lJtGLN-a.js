#!/usr/bin/env node
import { r as STANDARD_ACTIONS } from "./registry-DSWj5H6p.js";
import { t as runEcosystemCommand } from "./ecosystem-runner-DOAhdXEr.js";
//#region src/commands/test.ts
/**
* Run tests across all packages in the workspace.
*
* @returns exit code (0 = all passed, 1 = failures)
*/
async function runTest(parsers, options = {}) {
	return runEcosystemCommand(parsers, options, {
		action: STANDARD_ACTIONS.TEST,
		ignoreSource: "lint"
	});
}
//#endregion
export { runTest };

//# sourceMappingURL=test-lJtGLN-a.js.map