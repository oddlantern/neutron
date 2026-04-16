import { c as PASS, i as FAIL } from "./output-DN5bGOyX.js";
import { n as runCheck } from "./check-CCPCyhFP.js";
import { runFmt } from "./fmt-DIymNgQF.js";
import { runLint } from "./lint-e1FEeln6.js";
//#region src/commands/pre-commit.ts
/**
* Run the full pre-commit validation suite.
* Stops on first failure for fast feedback.
*
* Order: format check → lint → workspace check
*
* @returns exit code (0 = all pass, 1 = any failure)
*/
async function runPreCommit(parsers) {
	const steps = [
		{
			name: "format",
			run: () => runFmt(parsers, {
				check: true,
				quiet: true
			})
		},
		{
			name: "lint",
			run: () => runLint(parsers, { quiet: true })
		},
		{
			name: "workspace",
			run: () => runCheck(parsers, { quiet: true })
		}
	];
	for (const step of steps) {
		if (await step.run() !== 0) {
			console.log(`${FAIL} ${step.name}`);
			return 1;
		}
		console.log(`${PASS} ${step.name}`);
	}
	return 0;
}
//#endregion
export { runPreCommit };

//# sourceMappingURL=pre-commit-BM-XPNfH.js.map