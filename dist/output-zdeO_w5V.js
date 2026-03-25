#!/usr/bin/env node
//#region src/output.ts
const RESET = "\x1B[0m";
const BOLD = "\x1B[1m";
const DIM = "\x1B[2m";
const RED = "\x1B[31m";
const GREEN = "\x1B[32m";
const YELLOW = "\x1B[33m";
const CYAN = "\x1B[36m";
const PASS = `${GREEN}✓${RESET}`;
const FAIL = `${RED}✗${RESET}`;
const WARN = `${YELLOW}⚠${RESET}`;
function formatIssue(issue) {
	let output = `  ${issue.severity === "error" ? FAIL : WARN} ${issue.severity === "error" ? RED : YELLOW}${issue.message}${RESET}`;
	if (issue.details) {
		const indented = issue.details.split("\n").map((line) => `    ${DIM}${line}${RESET}`).join("\n");
		output += `\n${indented}`;
	}
	return output;
}
function formatCheckResult(result) {
	const header = `${result.passed ? PASS : FAIL} ${BOLD}${result.check}${RESET} ${DIM}— ${result.summary}${RESET}`;
	if (result.issues.length === 0) return header;
	return `${header}\n${result.issues.map(formatIssue).join("\n")}`;
}
function formatSummary(results) {
	const passed = results.filter((r) => r.passed).length;
	const failed = results.length - passed;
	const line = "─".repeat(48);
	if (failed === 0) return `\n${DIM}${line}${RESET}\n${GREEN}${BOLD}All ${passed} check(s) passed${RESET}\n`;
	return `\n${DIM}${line}${RESET}\n${RED}${BOLD}${failed} check(s) failed${RESET}, ${passed} passed\n`;
}
function formatHeader(workspaceName, packageCount) {
	return `\n${CYAN}${BOLD}mido${RESET} ${DIM}— workspace: ${workspaceName} (${packageCount} packages)${RESET}\n`;
}
//#endregion
export { RED as a, formatCheckResult as c, GREEN as i, formatHeader as l, CYAN as n, RESET as o, DIM as r, YELLOW as s, BOLD as t, formatSummary as u };

//# sourceMappingURL=output-zdeO_w5V.js.map