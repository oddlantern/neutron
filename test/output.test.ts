import { describe, expect, test } from "bun:test";

import type { CheckIssue, CheckResult } from "../src/checks/types";
import {
  BOLD,
  CYAN,
  DIM,
  FAIL,
  GREEN,
  MAGENTA,
  ORANGE,
  PASS,
  RED,
  RESET,
  WARN,
  YELLOW,
  formatCheckResult,
  formatHeader,
  formatSummary,
} from "../src/output";

const ESC = "\x1b[";

describe("color constants", () => {
  test("RESET contains ANSI escape", () => {
    expect(RESET).toContain(ESC);
  });

  test("BOLD contains ANSI escape", () => {
    expect(BOLD).toContain(ESC);
  });

  test("DIM contains ANSI escape", () => {
    expect(DIM).toContain(ESC);
  });

  test("RED contains ANSI escape", () => {
    expect(RED).toContain(ESC);
  });

  test("GREEN contains ANSI escape", () => {
    expect(GREEN).toContain(ESC);
  });

  test("YELLOW contains ANSI escape", () => {
    expect(YELLOW).toContain(ESC);
  });

  test("CYAN contains ANSI escape", () => {
    expect(CYAN).toContain(ESC);
  });

  test("ORANGE contains ANSI escape", () => {
    expect(ORANGE).toContain(ESC);
  });

  test("MAGENTA contains ANSI escape", () => {
    expect(MAGENTA).toContain(ESC);
  });
});

describe("icon constants", () => {
  test("PASS is a non-empty string containing ANSI codes", () => {
    expect(PASS.length).toBeGreaterThan(0);
    expect(PASS).toContain(ESC);
  });

  test("FAIL is a non-empty string containing ANSI codes", () => {
    expect(FAIL.length).toBeGreaterThan(0);
    expect(FAIL).toContain(ESC);
  });

  test("WARN is a non-empty string containing ANSI codes", () => {
    expect(WARN.length).toBeGreaterThan(0);
    expect(WARN).toContain(ESC);
  });
});

describe("formatCheckResult", () => {
  test("passing result contains check name", () => {
    const result: CheckResult = {
      check: "version-consistency",
      passed: true,
      issues: [],
      summary: "all versions match",
    };
    const output = formatCheckResult(result);
    expect(output).toContain("version-consistency");
  });

  test("passing result contains summary", () => {
    const result: CheckResult = {
      check: "bridges",
      passed: true,
      issues: [],
      summary: "all bridges valid",
    };
    const output = formatCheckResult(result);
    expect(output).toContain("all bridges valid");
  });

  test("passing result includes pass icon", () => {
    const result: CheckResult = {
      check: "test-check",
      passed: true,
      issues: [],
      summary: "ok",
    };
    const output = formatCheckResult(result);
    expect(output).toContain("✓");
  });

  test("failing result contains issue messages", () => {
    const issues: readonly CheckIssue[] = [
      {
        severity: "error",
        check: "versions",
        message: "lodash version mismatch: ^4.0.0 vs ^3.0.0",
      },
      {
        severity: "warning",
        check: "versions",
        message: "typescript version drift detected",
      },
    ];
    const result: CheckResult = {
      check: "versions",
      passed: false,
      issues,
      summary: "2 issues found",
    };
    const output = formatCheckResult(result);
    expect(output).toContain("lodash version mismatch: ^4.0.0 vs ^3.0.0");
    expect(output).toContain("typescript version drift detected");
  });

  test("failing result includes fail icon", () => {
    const result: CheckResult = {
      check: "test-check",
      passed: false,
      issues: [{ severity: "error", check: "test-check", message: "bad" }],
      summary: "failed",
    };
    const output = formatCheckResult(result);
    expect(output).toContain("✗");
  });

  test("issue with details includes indented detail lines", () => {
    const issues: readonly CheckIssue[] = [
      {
        severity: "error",
        check: "env",
        message: "missing key",
        details: "APP_SECRET not found in .env.production",
      },
    ];
    const result: CheckResult = {
      check: "env",
      passed: false,
      issues,
      summary: "1 issue",
    };
    const output = formatCheckResult(result);
    expect(output).toContain("APP_SECRET not found in .env.production");
  });
});

describe("formatSummary", () => {
  test("all passing shows pass count", () => {
    const results: readonly CheckResult[] = [
      { check: "a", passed: true, issues: [], summary: "ok" },
      { check: "b", passed: true, issues: [], summary: "ok" },
      { check: "c", passed: true, issues: [], summary: "ok" },
    ];
    const output = formatSummary(results);
    expect(output).toContain("3 check(s) passed");
  });

  test("some failing shows fail and pass counts", () => {
    const results: readonly CheckResult[] = [
      { check: "a", passed: true, issues: [], summary: "ok" },
      {
        check: "b",
        passed: false,
        issues: [{ severity: "error", check: "b", message: "fail" }],
        summary: "bad",
      },
    ];
    const output = formatSummary(results);
    expect(output).toContain("1 check(s) failed");
    expect(output).toContain("1 passed");
  });

  test("all failing shows correct fail count", () => {
    const results: readonly CheckResult[] = [
      {
        check: "a",
        passed: false,
        issues: [{ severity: "error", check: "a", message: "fail" }],
        summary: "bad",
      },
      {
        check: "b",
        passed: false,
        issues: [{ severity: "error", check: "b", message: "fail" }],
        summary: "bad",
      },
    ];
    const output = formatSummary(results);
    expect(output).toContain("2 check(s) failed");
    expect(output).toContain("0 passed");
  });
});

describe("formatHeader", () => {
  test("includes workspace name", () => {
    const output = formatHeader("my-monorepo", 5);
    expect(output).toContain("my-monorepo");
  });

  test("includes package count", () => {
    const output = formatHeader("workspace", 12);
    expect(output).toContain("12 packages");
  });

  test("includes neutron branding", () => {
    const output = formatHeader("test", 1);
    expect(output).toContain("neutron");
  });
});
