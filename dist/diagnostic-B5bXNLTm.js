import { a as GREEN, c as PASS, d as WARN, f as YELLOW, i as FAIL, l as RED, r as DIM, t as BOLD, u as RESET } from "./output-DN5bGOyX.js";
//#region src/diagnostic.ts
/**
* Accumulates diagnostics during command execution.
* Commands call `.error()` / `.warn()` as issues occur,
* then render a structured summary at the end with `formatDiagnostics()`.
*/
var DiagnosticCollector = class {
	#items = [];
	/** Record an error diagnostic. */
	error(message, options) {
		this.#items.push({
			severity: "error",
			message,
			detail: options?.detail,
			fix: options?.fix
		});
	}
	/** Record a warning diagnostic. */
	warn(message, options) {
		this.#items.push({
			severity: "warning",
			message,
			detail: options?.detail,
			fix: options?.fix
		});
	}
	/** Number of error-severity diagnostics. */
	get errors() {
		return this.#items.filter((d) => d.severity === "error").length;
	}
	/** Number of warning-severity diagnostics. */
	get warnings() {
		return this.#items.filter((d) => d.severity === "warning").length;
	}
	/** Whether any diagnostics (error or warning) have been recorded. */
	get hasIssues() {
		return this.#items.length > 0;
	}
	/** Whether any error-severity diagnostics have been recorded. */
	get hasErrors() {
		return this.#items.some((d) => d.severity === "error");
	}
	/** All recorded diagnostics in insertion order. */
	get items() {
		return [...this.#items];
	}
};
/**
* Render a structured diagnostic summary block.
*
* On success:
* ```
* ────────────────────────────────────────────────
* ✓ All 5 steps passed
* ────────────────────────────────────────────────
* ```
*
* On failure:
* ```
* ────────────────────────────────────────────────
* ✗ 2 errors, 1 warning
*
*   ✗ message — detail
*     → fix suggestion
*
*   ⚠ message
*     → fix suggestion
* ────────────────────────────────────────────────
* ```
*/
function formatDiagnostics(collector, totalSteps) {
	const separator = `${DIM}${"─".repeat(48)}${RESET}`;
	const items = collector.items;
	if (items.length === 0) return `\n${separator}\n${PASS} ${GREEN}${BOLD}All${totalSteps !== void 0 ? ` ${totalSteps} ${totalSteps === 1 ? "step" : "steps"}` : ""} passed${RESET}\n${separator}\n`;
	const errorCount = collector.errors;
	const warnCount = collector.warnings;
	const parts = [];
	if (errorCount > 0) parts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`);
	if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
	return `\n${separator}\n${`${FAIL} ${BOLD}${parts.join(", ")}${RESET}`}\n\n${items.map((d) => {
		let entry = `  ${d.severity === "error" ? FAIL : WARN} ${d.severity === "error" ? RED : YELLOW}${d.message}${RESET}`;
		if (d.detail) entry += `${DIM} \u2014 ${d.detail}${RESET}`;
		if (d.fix) entry += `\n    ${DIM}\u2192 ${d.fix}${RESET}`;
		return entry;
	}).join("\n\n")}\n${separator}\n`;
}
//#endregion
export { formatDiagnostics as n, DiagnosticCollector as t };

//# sourceMappingURL=diagnostic-B5bXNLTm.js.map