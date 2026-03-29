#!/usr/bin/env node
import { spawn } from "node:child_process";
//#region src/process.ts
/** Maximum bytes of stdout/stderr to accumulate per process. */
const MAX_OUTPUT_BYTES = 1024 * 1024;
/**
* Spawn a command and collect its output.
* Does NOT use shell: true — arguments are passed directly to the executable.
*/
function runCommand(command, args, cwd) {
	const start = performance.now();
	return new Promise((resolve) => {
		const child = spawn(command, [...args], {
			cwd,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		const chunks = [];
		let totalBytes = 0;
		child.stdout.on("data", (data) => {
			if (totalBytes < MAX_OUTPUT_BYTES) {
				chunks.push(data.toString());
				totalBytes += data.length;
			}
		});
		child.stderr.on("data", (data) => {
			if (totalBytes < MAX_OUTPUT_BYTES) {
				chunks.push(data.toString());
				totalBytes += data.length;
			}
		});
		child.on("close", (code) => {
			const duration = Math.round(performance.now() - start);
			const output = chunks.join("");
			if (code === 0) resolve({
				success: true,
				duration,
				summary: `${command} ${args.join(" ")} completed`,
				output
			});
			else resolve({
				success: false,
				duration,
				summary: `${command} ${args.join(" ")} failed (exit ${String(code)})`,
				output
			});
		});
		child.on("error", (err) => {
			resolve({
				success: false,
				duration: Math.round(performance.now() - start),
				summary: `Failed to spawn: ${err.message}`,
				output: err.message
			});
		});
	});
}
//#endregion
export { runCommand as t };

//# sourceMappingURL=process-ByVI-buF.js.map