import type { CheckIssue, CheckResult } from '../checks/types.js';

// ANSI color codes — no dependency needed
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

const PASS = `${GREEN}✓${RESET}`;
const FAIL = `${RED}✗${RESET}`;
const WARN = `${YELLOW}⚠${RESET}`;

function formatIssue(issue: CheckIssue): string {
  const icon = issue.severity === 'error' ? FAIL : WARN;
  const color = issue.severity === 'error' ? RED : YELLOW;
  let output = `  ${icon} ${color}${issue.message}${RESET}`;

  if (issue.details) {
    const indented = issue.details
      .split('\n')
      .map((line) => `    ${DIM}${line}${RESET}`)
      .join('\n');
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

  const issueLines = result.issues.map(formatIssue).join('\n');
  return `${header}\n${issueLines}`;
}

export function formatSummary(results: readonly CheckResult[]): string {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  const line = '─'.repeat(48);

  if (failed === 0) {
    return `\n${DIM}${line}${RESET}\n${GREEN}${BOLD}All ${passed} check(s) passed${RESET}\n`;
  }

  return `\n${DIM}${line}${RESET}\n${RED}${BOLD}${failed} check(s) failed${RESET}, ${passed} passed\n`;
}

export function formatHeader(workspaceName: string, packageCount: number): string {
  return `\n${CYAN}${BOLD}mido${RESET} ${DIM}— workspace: ${workspaceName} (${packageCount} packages)${RESET}\n`;
}
