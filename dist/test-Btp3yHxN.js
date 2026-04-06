#!/usr/bin/env node
import { r as STANDARD_ACTIONS } from "./registry-CkoeCZGV.js";
import { t as runEcosystemCommand } from "./ecosystem-runner-u3NJn4Z5.js";
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

//# sourceMappingURL=test-Btp3yHxN.js.map