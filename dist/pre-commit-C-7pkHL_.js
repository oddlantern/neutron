#!/usr/bin/env node
import { i as GREEN, o as RED, s as RESET } from "./output-D1Xg1ws_.js";
import { runCheck } from "./check-BfVJls7g.js";
import { runFmt } from "./fmt-DZLKXHwe.js";
import { runLint } from "./lint-BSEg8jta.js";
//#region src/commands/pre-commit.ts
const PASS = `${GREEN}✓${RESET}`;
const FAIL = `${RED}✗${RESET}`;
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

//# sourceMappingURL=pre-commit-C-7pkHL_.js.map