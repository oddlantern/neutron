#!/usr/bin/env node
import { r as STANDARD_ACTIONS } from "./registry-B0j5Offx.js";
import { t as runEcosystemCommand } from "./ecosystem-runner-CT-FY0Db.js";
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

//# sourceMappingURL=test-CqkD8yAX.js.map