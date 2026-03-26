import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { validateTokens } from "../../src/plugins/builtin/design/token-schema.js";

const FIXTURE_PATH = join(import.meta.dir, "..", "fixture-tokens", "tokens.json");

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
}

describe("validateTokens", () => {
  test("accepts valid complete tokens", () => {
    const result = validateTokens(loadFixture());
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.errors).toHaveLength(0);
  });

  test("has warnings for missing optional M3 color roles", () => {
    const result = validateTokens(loadFixture());
    expect(result.warnings.length).toBeGreaterThan(0);
    const missingSecondary = result.warnings.find((w) => w.path === "color.secondary");
    expect(missingSecondary).toBeDefined();
  });

  test("rejects missing required M3 color field", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const color = { ...(raw["color"] as Record<string, unknown>) };
    delete color["primary"];
    const result = validateTokens({ ...raw, color });
    expect(result.success).toBe(false);
    const primaryError = result.errors.find((e) => e.path === "color.primary");
    expect(primaryError).toBeDefined();
    expect(primaryError!.message).toContain("required");
  });

  test("rejects invalid hex color in extensions", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const extensions = {
      BadColors: {
        broken: { light: "#XYZ123", dark: "#000000" },
      },
    };
    const result = validateTokens({ ...raw, extensions });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("rejects invalid typography provider", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const typography = {
      ...(raw["typography"] as Record<string, unknown>),
      provider: "invalid_provider",
    };
    const result = validateTokens({ ...raw, typography });
    expect(result.success).toBe(false);
  });

  test("rejects invalid scale reference to missing fontWeight", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const typo = raw["typography"] as Record<string, unknown>;
    const typography = {
      ...typo,
      scale: {
        test: { size: 16, weight: "nonexistent", family: "body" },
      },
    };
    const result = validateTokens({ ...raw, typography });
    expect(result.success).toBe(false);
  });

  test("rejects non-positive spacing values", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = validateTokens({ ...raw, spacing: { bad: -1 } });
    expect(result.success).toBe(false);
  });

  test("accepts tokens without optional sections", () => {
    const minimal = {
      color: {
        primary: { light: "#B25134", dark: "#E07B5A" },
        onPrimary: { light: "#FAF9F5", dark: "#12171F" },
        surface: { light: "#FAF9F5", dark: "#12171F" },
        onSurface: { light: "#2C2416", dark: "#EDE6DA" },
        error: { light: "#A84444", dark: "#D46A6A" },
        onError: { light: "#FAF9F5", dark: "#12171F" },
      },
    };
    const result = validateTokens(minimal);
    expect(result.success).toBe(true);
  });
});
