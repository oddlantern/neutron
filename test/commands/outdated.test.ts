import { describe, expect, test } from "bun:test";

// Test the internal helpers — strip range and classify update

function stripRange(range: string): string {
  return range.replace(/^[\^~>=<\s]+/, "").split(/\s/)[0] ?? range;
}

function classifyUpdate(current: string, latest: string): "major" | "minor" | "patch" | null {
  const [cMajor, cMinor] = current.split(".").map(Number);
  const [lMajor, lMinor] = latest.split(".").map(Number);
  if (cMajor === undefined || cMinor === undefined || lMajor === undefined || lMinor === undefined) {
    return null;
  }
  if (lMajor > cMajor) return "major";
  if (lMinor > cMinor) return "minor";
  if (latest !== current) return "patch";
  return null;
}

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
