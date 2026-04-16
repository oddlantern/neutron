//#region src/checks/types.d.ts
type Severity = "error" | "warning";
interface CheckIssue {
  readonly severity: Severity;
  readonly check: string;
  readonly message: string;
  readonly details?: string | undefined;
}
interface CheckResult {
  readonly check: string;
  readonly passed: boolean;
  readonly issues: readonly CheckIssue[];
  readonly summary: string;
}
//#endregion
export { CheckResult as n, Severity as r, CheckIssue as t };
//# sourceMappingURL=types-CZkj_bZ_.d.ts.map