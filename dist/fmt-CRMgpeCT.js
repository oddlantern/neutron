#!/usr/bin/env node
import { r as STANDARD_ACTIONS } from "./registry-CADsZMlI.js";
import { t as runEcosystemCommand } from "./ecosystem-runner-3PPNub0F.js";
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

//# sourceMappingURL=fmt-CRMgpeCT.js.map