#!/usr/bin/env node
import { a as GREEN, c as PASS, i as FAIL, r as DIM, t as BOLD, u as RESET } from "./output-MbJ98jNX.js";
//#region src/commands/ci.ts
/**
* Run the full CI pipeline: generate → build → lint → test → check.
*
* Each step runs sequentially. Stops on first failure unless --continue is used.
* Designed to replace bespoke CI configs with a single `mido ci` command.
*
* @returns exit code (0 = all passed, 1 = failure)
*/
async function runCi(parsers, options = {}) {
	const { verbose = false } = options;
	console.log(`\n${BOLD}mido ci${RESET} ${DIM}— full pipeline${RESET}\n`);
	const results = [];
	const steps = [
		{
			name: "generate",
			run: async () => {
				const { runGenerate } = await import("./generate-CWHF_bg9.js");
				return runGenerate(parsers, {
					quiet: true,
					verbose
				});
			}
		},
		{
			name: "build",
			run: async () => {
				const { runBuild } = await import("./build-v7i-lcZb.js");
				return runBuild(parsers, { quiet: true });
			}
		},
		{
			name: "lint",
			run: async () => {
				const { runLint } = await import("./lint-BMpTdXGZ.js");
				return runLint(parsers, { quiet: true });
			}
		},
		{
			name: "test",
			run: async () => {
				const { runTest } = await import("./test-DzWqZQtw.js");
				return runTest(parsers, { quiet: true });
			}
		},
		{
			name: "check",
			run: async () => {
				const { runCheck } = await import("./check-DCTvxJWm.js").then((n) => n.t);
				return runCheck(parsers, { quiet: true });
			}
		}
	];
	let failed = false;
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
		const ms = duration >= 1e3 ? `${(duration / 1e3).toFixed(1)}s` : `${duration}ms`;
		console.log(`  ${icon} ${step.name} (${ms})`);
		if (exitCode !== 0) {
			failed = true;
			break;
		}
	}
	console.log();
	if (failed) {
		const failedStep = results.find((r) => r.exitCode !== 0);
		console.log(`${FAIL} ${BOLD}CI failed${RESET} at ${failedStep?.name ?? "unknown"}\n`);
		return 1;
	}
	const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
	const totalMs = totalDuration >= 1e3 ? `${(totalDuration / 1e3).toFixed(1)}s` : `${totalDuration}ms`;
	console.log(`${GREEN}${BOLD}CI passed${RESET} ${DIM}(${totalMs})${RESET}\n`);
	return 0;
}
//#endregion
export { runCi };

//# sourceMappingURL=ci-B6zWeWX2.js.map