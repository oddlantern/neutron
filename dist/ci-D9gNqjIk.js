#!/usr/bin/env node
import { a as GREEN, c as PASS, i as FAIL, r as DIM, t as BOLD, u as RESET } from "./output-MbJ98jNX.js";
import { n as formatDiagnostics, t as DiagnosticCollector } from "./diagnostic-ua3edMsw.js";
//#region src/commands/ci.ts
const MS_PER_SECOND = 1e3;
/**
* Run the full CI pipeline: generate → build → lint → test → check.
*
* Each step runs sequentially. Stops on first failure.
*
* @returns exit code (0 = all passed, 1 = failure)
*/
async function runCi(parsers, options = {}) {
	const { verbose = false } = options;
	console.log(`\n${BOLD}mido ci${RESET} ${DIM}— full pipeline${RESET}\n`);
	const diag = new DiagnosticCollector();
	const results = [];
	const steps = [
		{
			name: "generate",
			run: async () => {
				const { runGenerate } = await import("./generate-CADLzpzr.js");
				return runGenerate(parsers, {
					quiet: true,
					verbose
				});
			}
		},
		{
			name: "build",
			run: async () => {
				const { runBuild } = await import("./build-aO_fZGxD.js");
				return runBuild(parsers, { quiet: true });
			}
		},
		{
			name: "lint",
			run: async () => {
				const { runLint } = await import("./lint-DiDCJq6a.js");
				return runLint(parsers, { quiet: true });
			}
		},
		{
			name: "test",
			run: async () => {
				const { runTest } = await import("./test-BA_1F17U.js");
				return runTest(parsers, { quiet: true });
			}
		},
		{
			name: "check",
			run: async () => {
				const { runCheck } = await import("./check-BUBkRpbN.js").then((n) => n.t);
				return runCheck(parsers, { quiet: true });
			}
		}
	];
	for (const step of steps) {
		const start = performance.now();
		console.log(`  ${DIM}▸${RESET} ${step.name}...`);
		const exitCode = await step.run();
		const duration = Math.round(performance.now() - start);
		results.push({
			name: step.name,
			exitCode,
			duration
		});
		const icon = exitCode === 0 ? PASS : FAIL;
		const ms = duration >= MS_PER_SECOND ? `${(duration / MS_PER_SECOND).toFixed(1)}s` : `${duration}ms`;
		console.log(`  ${icon} ${step.name} (${ms})`);
		if (exitCode !== 0) {
			diag.error(`${step.name} failed`, {
				detail: `exit code ${exitCode}`,
				fix: `Run mido ${step.name} for full output`
			});
			break;
		}
	}
	const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
	const totalMs = totalDuration >= MS_PER_SECOND ? `${(totalDuration / MS_PER_SECOND).toFixed(1)}s` : `${totalDuration}ms`;
	if (!diag.hasErrors) console.log(`\n${GREEN}${BOLD}CI passed${RESET} ${DIM}(${totalMs})${RESET}`);
	console.log(formatDiagnostics(diag, steps.length));
	return diag.hasErrors ? 1 : 0;
}
//#endregion
export { runCi };

//# sourceMappingURL=ci-D9gNqjIk.js.map