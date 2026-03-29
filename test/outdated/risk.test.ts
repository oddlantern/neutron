import { describe, expect, test } from "bun:test";

import { computeRisk } from "@/outdated/risk";

describe("computeRisk", () => {
  test("major update with 1 package scores 45", () => {
    const risk = computeRisk("major", 1, false, 0);
    expect(risk.severity).toBe(40);
    expect(risk.affectedCount).toBe(5);
    expect(risk.deprecation).toBe(0);
    expect(risk.peerConflicts).toBe(0);
    expect(risk.total).toBe(45);
  });

  test("minor update scores 15 for severity", () => {
    const risk = computeRisk("minor", 1, false, 0);
    expect(risk.severity).toBe(15);
    expect(risk.total).toBe(20); // 15 + 5
  });

  test("patch update scores 5 for severity", () => {
    const risk = computeRisk("patch", 1, false, 0);
    expect(risk.severity).toBe(5);
    expect(risk.total).toBe(10); // 5 + 5
  });

  test("affected count caps at 20", () => {
    const risk = computeRisk("patch", 10, false, 0);
    expect(risk.affectedCount).toBe(20); // 10 * 5 = 50, capped at 20
    expect(risk.total).toBe(25); // 5 + 20
  });

  test("deprecation adds 25", () => {
    const risk = computeRisk("patch", 1, true, 0);
    expect(risk.deprecation).toBe(25);
    expect(risk.total).toBe(35); // 5 + 5 + 25
  });

  test("peer conflicts add 15", () => {
    const risk = computeRisk("patch", 1, false, 2);
    expect(risk.peerConflicts).toBe(15);
    expect(risk.total).toBe(25); // 5 + 5 + 15
  });

  test("maximum score is 100", () => {
    const risk = computeRisk("major", 10, true, 3);
    expect(risk.total).toBe(100); // 40 + 20 + 25 + 15 = 100
  });

  test("all factors combined cap at 100", () => {
    const risk = computeRisk("major", 20, true, 5);
    expect(risk.total).toBe(100); // Would be 40 + 20 + 25 + 15 = 100
  });

  test("zero packages scores 0 for affected", () => {
    const risk = computeRisk("major", 0, false, 0);
    expect(risk.affectedCount).toBe(0);
    expect(risk.total).toBe(40);
  });
});
