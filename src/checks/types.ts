export type Severity = "error" | "warning";

export interface CheckIssue {
  readonly severity: Severity;
  readonly check: string;
  readonly message: string;
  readonly details?: string | undefined;
}

export interface CheckResult {
  readonly check: string;
  readonly passed: boolean;
  readonly issues: readonly CheckIssue[];
  readonly summary: string;
}
