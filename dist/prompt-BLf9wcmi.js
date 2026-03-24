#!/usr/bin/env node
import { createInterface } from "node:readline";
//#region src/prompt.ts
let rl = null;
let bufferedLines = null;
let lineIndex = 0;
function ensureReadline() {
	if (rl) return rl;
	rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: process.stdin.isTTY === true
	});
	return rl;
}
async function bufferStdin() {
	if (bufferedLines) return;
	if (process.stdin.isTTY) return;
	bufferedLines = [];
	const iface = ensureReadline();
	return new Promise((resolve) => {
		iface.on("line", (line) => {
			bufferedLines?.push(line);
		});
		iface.on("close", () => {
			resolve();
		});
	});
}
function ask(question) {
	if (bufferedLines) {
		process.stdout.write(question);
		const line = bufferedLines[lineIndex] ?? "";
		lineIndex++;
		process.stdout.write(line + "\n");
		return Promise.resolve(line);
	}
	const iface = ensureReadline();
	return new Promise((resolve) => {
		iface.question(question, (answer) => {
			resolve(answer.trim());
		});
	});
}
async function promptVersionResolution(depName, choices, lockedRange) {
	await bufferStdin();
	const ranges = [...new Set(choices.map((c) => c.range))];
	const totalPackages = choices.length;
	console.log(`\n  ${depName} — ${totalPackages} packages, ${ranges.length} ranges`);
	if (lockedRange) console.log(`  locked: ${lockedRange}`);
	console.log("");
	for (let i = 0; i < choices.length; i++) {
		const c = choices[i];
		if (!c) continue;
		console.log(`    ${i + 1}) ${c.range}  ← ${c.packagePath} (${c.ecosystem}) [${c.type}]`);
	}
	console.log("    s) skip");
	console.log("    c) custom range");
	console.log("");
	const answer = await ask("    Pick: ");
	if (answer === "s") return null;
	let chosenRange;
	if (answer === "c") {
		chosenRange = await ask("    Custom range: ");
		if (chosenRange === "") return null;
	} else {
		const idx = parseInt(answer, 10);
		if (isNaN(idx) || idx < 1 || idx > choices.length) {
			console.log("    Invalid choice, skipping.");
			return null;
		}
		const picked = choices[idx - 1];
		if (!picked) {
			console.log("    Invalid choice, skipping.");
			return null;
		}
		chosenRange = picked.range;
	}
	const targets = choices.filter((c) => c.range !== chosenRange);
	return {
		depName,
		chosenRange,
		targets
	};
}
function closePrompt() {
	if (rl) {
		rl.close();
		rl = null;
	}
	bufferedLines = null;
	lineIndex = 0;
}
//#endregion
export { closePrompt as n, promptVersionResolution as r, ask as t };

//# sourceMappingURL=prompt-BLf9wcmi.js.map