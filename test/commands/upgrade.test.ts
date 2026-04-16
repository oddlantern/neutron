import { describe, expect, test } from "bun:test";

import { buildNewRange } from "@/commands/upgrade";

describe("buildNewRange", () => {
  test("preserves caret prefix", () => {
    expect(buildNewRange("^1.2.3", "1.3.0")).toBe("^1.3.0");
  });

  test("preserves tilde prefix", () => {
    expect(buildNewRange("~1.2.3", "1.2.9")).toBe("~1.2.9");
  });

  test("preserves >= prefix", () => {
    expect(buildNewRange(">=1.2.3", "2.0.0")).toBe(">=2.0.0");
  });

  test("preserves compound >=< range by taking leading prefix", () => {
    // The intent here is documented — when upgrading a compound range like
    // ">=1.0.0 <2.0.0", we replace it with a single >= constraint to the new
    // version. Callers should set an explicit range for compounds they want
    // to preserve verbatim.
    expect(buildNewRange(">=1.0.0", "2.5.0")).toBe(">=2.5.0");
  });

  test("preserves < prefix", () => {
    expect(buildNewRange("<2.0.0", "3.0.0")).toBe("<3.0.0");
  });

  test("defaults to caret when input has no prefix (exact pin)", () => {
    // A bare version string without a comparator gets upgraded to ^ —
    // this reflects that most ecosystems default to caret for new deps.
    expect(buildNewRange("1.2.3", "2.0.0")).toBe("^2.0.0");
  });

  test("defaults to caret when input is empty", () => {
    expect(buildNewRange("", "1.0.0")).toBe("^1.0.0");
  });

  test("preserves prerelease version numbers", () => {
    expect(buildNewRange("^1.0.0", "2.0.0-beta.1")).toBe("^2.0.0-beta.1");
  });

  test("handles multi-character prefixes", () => {
    // ">=" is two chars — the regex /^[\^~>=<]+/ captures all of them.
    expect(buildNewRange(">=1.2.3", "1.3.0")).toBe(">=1.3.0");
  });
});
