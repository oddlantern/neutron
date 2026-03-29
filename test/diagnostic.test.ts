import { describe, expect, test } from "bun:test";

import { DiagnosticCollector, formatDiagnostics } from "../src/diagnostic";

describe("DiagnosticCollector", () => {
  test("starts empty", () => {
    const diag = new DiagnosticCollector();
    expect(diag.errors).toBe(0);
    expect(diag.warnings).toBe(0);
    expect(diag.hasIssues).toBe(false);
    expect(diag.hasErrors).toBe(false);
    expect(diag.items).toEqual([]);
  });

  test("error() adds an error diagnostic", () => {
    const diag = new DiagnosticCollector();
    diag.error("Build failed", { detail: "exit code 1", fix: "Check logs" });

    expect(diag.errors).toBe(1);
    expect(diag.warnings).toBe(0);
    expect(diag.hasIssues).toBe(true);
    expect(diag.hasErrors).toBe(true);
    expect(diag.items).toHaveLength(1);
    expect(diag.items[0]?.severity).toBe("error");
    expect(diag.items[0]?.message).toBe("Build failed");
    expect(diag.items[0]?.detail).toBe("exit code 1");
    expect(diag.items[0]?.fix).toBe("Check logs");
  });

  test("warn() adds a warning diagnostic", () => {
    const diag = new DiagnosticCollector();
    diag.warn("Deprecated package");

    expect(diag.errors).toBe(0);
    expect(diag.warnings).toBe(1);
    expect(diag.hasIssues).toBe(true);
    expect(diag.hasErrors).toBe(false);
    expect(diag.items[0]?.severity).toBe("warning");
  });

  test("accumulates multiple diagnostics in order", () => {
    const diag = new DiagnosticCollector();
    diag.error("First error");
    diag.warn("A warning");
    diag.error("Second error");

    expect(diag.errors).toBe(2);
    expect(diag.warnings).toBe(1);
    expect(diag.items).toHaveLength(3);
    expect(diag.items[0]?.message).toBe("First error");
    expect(diag.items[1]?.message).toBe("A warning");
    expect(diag.items[2]?.message).toBe("Second error");
  });

  test("options are optional", () => {
    const diag = new DiagnosticCollector();
    diag.error("Bare error");
    diag.warn("Bare warning");

    expect(diag.items[0]?.detail).toBeUndefined();
    expect(diag.items[0]?.fix).toBeUndefined();
    expect(diag.items[1]?.detail).toBeUndefined();
    expect(diag.items[1]?.fix).toBeUndefined();
  });

  test("items returns a copy (not the internal array)", () => {
    const diag = new DiagnosticCollector();
    diag.error("Error");

    const items1 = diag.items;
    const items2 = diag.items;
    expect(items1).not.toBe(items2);
    expect(items1).toEqual(items2);
  });
});

describe("formatDiagnostics", () => {
  test("empty collector without steps shows all passed", () => {
    const diag = new DiagnosticCollector();
    const output = formatDiagnostics(diag);

    expect(output).toContain("All");
    expect(output).toContain("passed");
    // Should contain separator lines
    expect(output).toContain("─");
  });

  test("empty collector with totalSteps shows step count", () => {
    const diag = new DiagnosticCollector();
    const output = formatDiagnostics(diag, 5);

    expect(output).toContain("5 steps");
    expect(output).toContain("passed");
  });

  test("single error renders with fix suggestion", () => {
    const diag = new DiagnosticCollector();
    diag.error("Install failed", { detail: "peer conflict", fix: "Run bun install --force" });
    const output = formatDiagnostics(diag);

    expect(output).toContain("1 error");
    expect(output).toContain("Install failed");
    expect(output).toContain("peer conflict");
    expect(output).toContain("Run bun install --force");
    // Arrow for fix suggestion
    expect(output).toContain("\u2192");
  });

  test("mixed errors and warnings", () => {
    const diag = new DiagnosticCollector();
    diag.error("Build failed");
    diag.warn("Deprecated package", { fix: "Upgrade to v3" });
    diag.error("Test failed");
    const output = formatDiagnostics(diag);

    expect(output).toContain("2 errors");
    expect(output).toContain("1 warning");
    expect(output).toContain("Build failed");
    expect(output).toContain("Deprecated package");
    expect(output).toContain("Test failed");
    expect(output).toContain("Upgrade to v3");
  });

  test("warning without error shows only warning count", () => {
    const diag = new DiagnosticCollector();
    diag.warn("Skipped 3 packages");
    const output = formatDiagnostics(diag);

    expect(output).toContain("1 warning");
    expect(output).not.toContain("error");
  });

  test("detail rendered with em dash", () => {
    const diag = new DiagnosticCollector();
    diag.error("Failed", { detail: "exit code 127" });
    const output = formatDiagnostics(diag);

    // Em dash U+2014
    expect(output).toContain("\u2014");
    expect(output).toContain("exit code 127");
  });

  test("message without detail or fix renders cleanly", () => {
    const diag = new DiagnosticCollector();
    diag.error("Something broke");
    const output = formatDiagnostics(diag);

    expect(output).toContain("Something broke");
    // Should not contain arrow or em dash
    expect(output).not.toContain("\u2192");
    expect(output).not.toContain("\u2014");
  });
});
