import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { validateTokens } from "../../src/plugins/builtin/design/token-schema.js";

const FIXTURE_PATH = join(import.meta.dir, "..", "fixture-tokens", "tokens.json");

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
}

describe("validateTokens", () => {
  test("accepts the full NextSaga tokens.json with zero errors", () => {
    const result = validateTokens(loadFixture());
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.errors).toHaveLength(0);
  });

  test("parses standard sections correctly", () => {
    const result = validateTokens(loadFixture());
    expect(result.data?.standard.brand["terracotta"]).toBe("#C45A3B");
    expect(result.data?.standard.color["primary"].light).toBe("#B25134");
    expect(result.data?.standard.spacing["none"]).toBe(0);
    expect(result.data?.standard.spacing["xs"]).toBe(4);
    expect(result.data?.standard.radius["full"]).toBe(9999);
    expect(result.data?.standard.elevation["none"].dp).toBe(0);
    expect(result.data?.standard.elevation["none"].shadow.light).toHaveLength(0);
    expect(result.data?.standard.iconSize["hero"]).toBe(120);
  });

  test("discovers custom extension sections", () => {
    const result = validateTokens(loadFixture());
    expect(result.data?.extensions["extended"]).toBeDefined();
    expect(result.data?.extensions["genre"]).toBeDefined();
    // meta is a standard key, not an extension
    expect(result.data?.extensions["meta"]).toBeUndefined();
    // color is a standard key
    expect(result.data?.extensions["color"]).toBeUndefined();
  });

  test("extension fields are parsed as themed colors", () => {
    const result = validateTokens(loadFixture());
    const extended = result.data?.extensions["extended"];
    expect(extended?.fields["brand"]).toEqual({ light: "#C45A3B", dark: "#E07B5A" });
    expect(extended?.fields["premium"]).toEqual({ light: "#C9A227", dark: "#D4AD2E" });
  });

  test("extension rgba() values are accepted", () => {
    const result = validateTokens(loadFixture());
    const extended = result.data?.extensions["extended"];
    expect(extended?.fields["disabledForeground"]?.light).toBe("rgba(92, 77, 58, 0.40)");
  });

  test("extension meta uses PascalCase class name from key", () => {
    const result = validateTokens(loadFixture());
    expect(result.data?.extensions["extended"]?.meta.className).toBe("Extended");
    expect(result.data?.extensions["genre"]?.meta.className).toBe("Genre");
  });

  test("extension meta uses camelCase getter from key", () => {
    const result = validateTokens(loadFixture());
    expect(result.data?.extensions["extended"]?.meta.getter).toBe("extended");
    expect(result.data?.extensions["genre"]?.meta.getter).toBe("genre");
  });

  test("supports _className and _getter metadata overrides", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const withMeta = {
      ...raw,
      customSection: {
        _className: "MyColors",
        _getter: "myColors",
        brand: { light: "#000000", dark: "#FFFFFF" },
      },
    };
    const result = validateTokens(withMeta);
    expect(result.success).toBe(true);
    expect(result.data?.extensions["customSection"]?.meta.className).toBe("MyColors");
    expect(result.data?.extensions["customSection"]?.meta.getter).toBe("myColors");
    // _className and _getter should not be in fields
    expect(result.data?.extensions["customSection"]?.fields["_className"]).toBeUndefined();
    expect(result.data?.extensions["customSection"]?.fields["_getter"]).toBeUndefined();
  });

  test("rejects missing required M3 color field", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const color = { ...(raw["color"] as Record<string, unknown>) };
    delete color["primary"];
    const result = validateTokens({ ...raw, color });
    expect(result.success).toBe(false);
    const primaryError = result.errors.find((e) => e.path === "color.primary");
    expect(primaryError).toBeDefined();
  });

  test("rejects negative spacing values", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = validateTokens({ ...raw, spacing: { bad: -1 } });
    expect(result.success).toBe(false);
  });

  test("accepts zero spacing", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = validateTokens({ ...raw, spacing: { none: 0 } });
    expect(result.success).toBe(true);
  });

  test("accepts empty shadow arrays", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = validateTokens({
      ...raw,
      elevation: { none: { dp: 0, shadow: { light: [], dark: [] } } },
    });
    expect(result.success).toBe(true);
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
    expect(result.data?.extensions).toEqual({});
  });

  test("typography defaults provider to asset when missing", () => {
    const result = validateTokens(loadFixture());
    expect(result.data?.standard.typography?.provider).toBe("asset");
  });
});
