import { describe, expect, test } from "bun:test";

import { isRecord } from "../src/guards";

describe("isRecord", () => {
  test("returns true for plain objects", () => {
    expect(isRecord({ a: 1, b: "two" })).toBe(true);
  });

  test("returns true for empty object", () => {
    expect(isRecord({})).toBe(true);
  });

  test("returns true for object with nested properties", () => {
    expect(isRecord({ nested: { deep: true } })).toBe(true);
  });

  test("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  test("returns false for arrays", () => {
    expect(isRecord([1, 2, 3])).toBe(false);
  });

  test("returns false for empty array", () => {
    expect(isRecord([])).toBe(false);
  });

  test("returns false for strings", () => {
    expect(isRecord("hello")).toBe(false);
  });

  test("returns false for numbers", () => {
    expect(isRecord(42)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isRecord(undefined)).toBe(false);
  });

  test("returns false for boolean", () => {
    expect(isRecord(true)).toBe(false);
  });

  test("returns true for Object.create(null)", () => {
    expect(isRecord(Object.create(null))).toBe(true);
  });
});
