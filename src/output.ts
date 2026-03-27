import type { CheckIssue, CheckResult } from "./checks/types.js";

// ANSI color codes — no dependency needed
export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const RED = "\x1b[31m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const CYAN = "\x1b[36m";
/** mido brand orange — ANSI 256-color 208 */
export const ORANGE = "\x1b[38;5;208m";
export const MAGENTA = "\x1b[35m";

export const PASS = `${GREEN}✓${RESET}`;
export const FAIL = `${RED}✗${RESET}`;
export const WARN = `${YELLOW}⚠${RESET}`;

function formatIssue(issue: CheckIssue): string {
  const icon = issue.severity === "error" ? FAIL : WARN;
  const color = issue.severity === "error" ? RED : YELLOW;
  let output = `  ${icon} ${color}${issue.message}${RESET}`;

  if (issue.details) {
    const indented = issue.details
      .split("\n")
      .map((line) => `    ${DIM}${line}${RESET}`)
      .join("\n");
    output += `\n${indented}`;
  }

  return output;
}

export function formatCheckResult(result: CheckResult): string {
  const icon = result.passed ? PASS : FAIL;
  const header = `${icon} ${BOLD}${result.check}${RESET} ${DIM}— ${result.summary}${RESET}`;

  if (result.issues.length === 0) {
    return header;
  }

  const issueLines = result.issues.map(formatIssue).join("\n");
  return `${header}\n${issueLines}`;
}

export function formatSummary(results: readonly CheckResult[]): string {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  const SEPARATOR_WIDTH = 48;
  const line = "─".repeat(SEPARATOR_WIDTH);

  if (failed === 0) {
    return `\n${DIM}${line}${RESET}\n${GREEN}${BOLD}All ${passed} check(s) passed${RESET}\n`;
  }

  return `\n${DIM}${line}${RESET}\n${RED}${BOLD}${failed} check(s) failed${RESET}, ${passed} passed\n`;
}

export function formatHeader(workspaceName: string, packageCount: number): string {
  return `\n${CYAN}${BOLD}mido${RESET} ${DIM}— workspace: ${workspaceName} (${packageCount} packages)${RESET}\n`;
}
