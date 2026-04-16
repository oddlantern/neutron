import { BOLD, DIM, FAIL, GREEN, PASS, RED, RESET, WARN, YELLOW } from "@/output";

import { SEPARATOR_WIDTH } from "@/output";

/** A structured diagnostic finding from a command execution. */
export interface Diagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly detail?: string | undefined;
  readonly fix?: string | undefined;
}

/** Options for adding a diagnostic. */
interface DiagnosticOptions {
  readonly detail?: string | undefined;
  readonly fix?: string | undefined;
}

/**
 * Accumulates diagnostics during command execution.
 * Commands call `.error()` / `.warn()` as issues occur,
 * then render a structured summary at the end with `formatDiagnostics()`.
 */
export class DiagnosticCollector {
  readonly #items: Diagnostic[] = [];

  /** Record an error diagnostic. */
  error(message: string, options?: DiagnosticOptions): void {
    this.#items.push({ severity: "error", message, detail: options?.detail, fix: options?.fix });
  }

  /** Record a warning diagnostic. */
  warn(message: string, options?: DiagnosticOptions): void {
    this.#items.push({ severity: "warning", message, detail: options?.detail, fix: options?.fix });
  }

  /** Number of error-severity diagnostics. */
  get errors(): number {
    return this.#items.filter((d) => d.severity === "error").length;
  }

  /** Number of warning-severity diagnostics. */
  get warnings(): number {
    return this.#items.filter((d) => d.severity === "warning").length;
  }

  /** Whether any diagnostics (error or warning) have been recorded. */
  get hasIssues(): boolean {
    return this.#items.length > 0;
  }

  /** Whether any error-severity diagnostics have been recorded. */
  get hasErrors(): boolean {
    return this.#items.some((d) => d.severity === "error");
  }

  /** All recorded diagnostics in insertion order. */
  get items(): readonly Diagnostic[] {
    return [...this.#items];
  }
}

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
export function formatDiagnostics(
  collector: DiagnosticCollector,
  totalSteps?: number | undefined,
): string {
  const separator = `${DIM}${"─".repeat(SEPARATOR_WIDTH)}${RESET}`;
  const items = collector.items;

  if (items.length === 0) {
    const stepNote =
      totalSteps !== undefined ? ` ${totalSteps} ${totalSteps === 1 ? "step" : "steps"}` : "";
    return `\n${separator}\n${PASS} ${GREEN}${BOLD}All${stepNote} passed${RESET}\n${separator}\n`;
  }

  const errorCount = collector.errors;
  const warnCount = collector.warnings;

  const parts: string[] = [];
  if (errorCount > 0) {
    parts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`);
  }
  if (warnCount > 0) {
    parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
  }

  const header = `${FAIL} ${BOLD}${parts.join(", ")}${RESET}`;

  const body = items
    .map((d) => {
      const icon = d.severity === "error" ? FAIL : WARN;
      const color = d.severity === "error" ? RED : YELLOW;
      let entry = `  ${icon} ${color}${d.message}${RESET}`;
      if (d.detail) {
        entry += `${DIM} \u2014 ${d.detail}${RESET}`;
      }
      if (d.fix) {
        entry += `\n    ${DIM}\u2192 ${d.fix}${RESET}`;
      }
      return entry;
    })
    .join("\n\n");

  return `\n${separator}\n${header}\n\n${body}\n${separator}\n`;
}
