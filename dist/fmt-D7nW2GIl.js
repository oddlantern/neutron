#!/usr/bin/env node
import { r as STANDARD_ACTIONS } from "./registry-CkoeCZGV.js";
import { t as runEcosystemCommand } from "./ecosystem-runner-u3NJn4Z5.js";
//#region src/commands/fmt.ts
/**
* Run formatting across all packages in the workspace.
*
* @returns exit code (0 = all formatted, 1 = unformatted files found in check mode)
*/
async function runFmt(parsers, options = {}) {
	const { check = false, ...rest } = options;
	return runEcosystemCommand(parsers, rest, {
		action: check ? STANDARD_ACTIONS.FORMAT_CHECK : STANDARD_ACTIONS.FORMAT,
		ignoreSource: "format"
	});
}
//#endregion
export { runFmt };

//# sourceMappingURL=fmt-D7nW2GIl.js.map