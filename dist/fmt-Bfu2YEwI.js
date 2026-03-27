#!/usr/bin/env node
import { r as STANDARD_ACTIONS } from "./registry-B-Y0RSY6.js";
import { t as runEcosystemCommand } from "./ecosystem-runner-8GeVEiov.js";
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
		ignoreSource: "format",
		summary: check ? ["All files formatted", "Formatting issues found"] : ["All formatted", "Formatting failed"]
	});
}
//#endregion
export { runFmt };

//# sourceMappingURL=fmt-Bfu2YEwI.js.map