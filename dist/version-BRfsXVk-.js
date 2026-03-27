#!/usr/bin/env node
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
//#region src/guards.ts
/** Shared type guards used across the codebase */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
//#region src/output.ts
const RESET = "\x1B[0m";
const BOLD = "\x1B[1m";
const DIM = "\x1B[2m";
const RED = "\x1B[31m";
const GREEN = "\x1B[32m";
const YELLOW = "\x1B[33m";
const CYAN = "\x1B[36m";
/** mido brand orange — ANSI 256-color 208 */
const ORANGE = "\x1B[38;5;208m";
const MAGENTA = "\x1B[35m";
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
//#region src/version.ts
/** Absolute path to the mido package root directory. */
const MIDO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = join(MIDO_ROOT, "package.json");
const raw = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
function extractVersion(data) {
	if (!isRecord(data)) return "0.0.0";
	return typeof data["version"] === "string" ? data["version"] : "0.0.0";
}
const VERSION = extractVersion(raw);
//#endregion
export { formatSummary as _, DIM as a, MAGENTA as c, RED as d, RESET as f, formatHeader as g, formatCheckResult as h, CYAN as i, ORANGE as l, YELLOW as m, VERSION as n, FAIL as o, WARN as p, BOLD as r, GREEN as s, MIDO_ROOT as t, PASS as u, isRecord as v };

//# sourceMappingURL=version-BRfsXVk-.js.map