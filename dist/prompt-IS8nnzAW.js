#!/usr/bin/env node
import { basename, dirname, join } from "node:path";
import { readdirSync, statSync } from "node:fs";
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
function pathCompleter(root) {
	return (line) => {
		const partial = line;
		const dir = partial.includes("/") ? dirname(partial) : ".";
		const prefix = partial.includes("/") ? basename(partial) : partial;
		const absDir = join(root, dir);
		let entries;
		try {
			entries = readdirSync(absDir);
		} catch {
			return [[], line];
		}
		return [entries.filter((e) => e.startsWith(prefix) && !e.startsWith(".")).map((e) => {
			const full = join(absDir, e);
			let isDir = false;
			try {
				isDir = statSync(full).isDirectory();
			} catch {}
			const rel = dir === "." ? e : `${dir}/${e}`;
			return isDir ? `${rel}/` : rel;
		}), line];
	};
}
/**
* Ask for a file path with tab-completion relative to the given root.
* Spawns a temporary readline instance with a completer, then restores
* the shared one.
*/
function askPath(question, root) {
	if (bufferedLines) {
		process.stdout.write(question);
		const line = bufferedLines[lineIndex] ?? "";
		lineIndex++;
		process.stdout.write(line + "\n");
		return Promise.resolve(line);
	}
	if (rl) {
		rl.close();
		rl = null;
	}
	const completer = pathCompleter(root);
	const pathRl = createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: process.stdin.isTTY === true,
		completer
	});
	return new Promise((resolve) => {
		pathRl.question(question, (answer) => {
			pathRl.close();
			resolve(answer.trim());
		});
	});
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
export { promptVersionResolution as i, askPath as n, closePrompt as r, ask as t };

//# sourceMappingURL=prompt-IS8nnzAW.js.map