#!/usr/bin/env node
import { r as STANDARD_ACTIONS } from "./registry-BrU4OPPH.js";
import { t as runEcosystemCommand } from "./ecosystem-runner-CSvxf8t6.js";
//#region src/commands/test.ts
/**
* Run tests across all packages in the workspace.
*
* @returns exit code (0 = all passed, 1 = failures)
*/
async function runTest(parsers, options = {}) {
	return runEcosystemCommand(parsers, options, {
		action: STANDARD_ACTIONS.TEST,
		ignoreSource: "lint",
		summary: ["All tests passed", "Test failures found"]
	});
}
//#endregion
export { runTest };

//# sourceMappingURL=test-DAPhuEjs.js.map