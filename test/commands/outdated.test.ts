import { describe, expect, test } from "bun:test";

import { stripRange, classifyUpdate } from "@/outdated/collect";

describe("outdated — stripRange", () => {
  test("strips ^", () => expect(stripRange("^1.2.3")).toBe("1.2.3"));
  test("strips ~", () => expect(stripRange("~1.2.3")).toBe("1.2.3"));
  test("strips >=", () => expect(stripRange(">=1.2.3")).toBe("1.2.3"));
  test("handles bare version", () => expect(stripRange("1.2.3")).toBe("1.2.3"));
  test("handles range with space", () => expect(stripRange(">=1.0.0 <2.0.0")).toBe("1.0.0"));
});

describe("outdated — classifyUpdate", () => {
  test("detects major", () => expect(classifyUpdate("1.2.3", "2.0.0")).toBe("major"));
  test("detects minor", () => expect(classifyUpdate("1.2.3", "1.3.0")).toBe("minor"));
  test("detects patch", () => expect(classifyUpdate("1.2.3", "1.2.4")).toBe("patch"));
  test("returns null when same", () => expect(classifyUpdate("1.2.3", "1.2.3")).toBe(null));
  test("returns null for invalid", () => expect(classifyUpdate("abc", "1.0.0")).toBe(null));
});
