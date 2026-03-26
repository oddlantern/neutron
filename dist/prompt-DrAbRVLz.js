#!/usr/bin/env node
import { cancel, confirm, isCancel, select, text } from "@clack/prompts";
//#region src/prompt.ts
function handleCancel() {
	cancel("Aborted.");
	process.exit(0);
}
async function promptVersionResolution(depName, choices, lockedRange) {
	const ranges = [...new Set(choices.map((c) => c.range))];
	let message = `${depName} — ${choices.length} packages, ${ranges.length} ranges`;
	if (lockedRange) message += ` (locked: ${lockedRange})`;
	const options = choices.map((c, i) => ({
		value: String(i),
		label: c.range,
		hint: `${c.packagePath} (${c.ecosystem}) [${c.type}]`
	}));
	options.push({
		value: "skip",
		label: "Skip",
		hint: ""
	});
	options.push({
		value: "custom",
		label: "Custom range",
		hint: ""
	});
	const answer = await select({
		message,
		options
	});
	if (isCancel(answer)) handleCancel();
	if (answer === "skip") return null;
	let chosenRange;
	if (answer === "custom") {
		const custom = await text({ message: "Custom range:" });
		if (isCancel(custom) || !custom) return null;
		chosenRange = custom;
	} else {
		const picked = choices[parseInt(answer, 10)];
		if (!picked) return null;
		chosenRange = picked.range;
	}
	const targets = choices.filter((c) => c.range !== chosenRange);
	return {
		depName,
		chosenRange,
		targets
	};
}
async function confirmAction(message, defaultValue = true) {
	const result = await confirm({
		message,
		initialValue: defaultValue
	});
	if (isCancel(result)) handleCancel();
	return result;
}
//#endregion
export { promptVersionResolution as n, confirmAction as t };

//# sourceMappingURL=prompt-DrAbRVLz.js.map