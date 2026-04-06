import { describe, expect, test } from "bun:test";

import type { ValidatedTokens } from "../../src/plugins/builtin/domain/design/types.js";
import { generateTailwindCSS, generateTailwindTS } from "../../src/plugins/builtin/ecosystem/typescript/tailwind-codegen.js";
import { generateBootstrapScss } from "../../src/plugins/builtin/ecosystem/typescript/bootstrap-codegen.js";

const FIXTURE_TOKENS: ValidatedTokens = {
  standard: {
    brand: {},
    color: {
      primary: { light: "#6750A4", dark: "#D0BCFF" },
      onPrimary: { light: "#FFFFFF", dark: "#381E72" },
      surface: { light: "#FEF7FF", dark: "#141218" },
    },
    spacing: {
      xs: 4,
      sm: 8,
      md: 16,
      lg: 24,
    },
    radius: {
      sm: 4,
      md: 8,
      full: 9999,
    },
    elevation: {},
    iconSize: {
      sm: 16,
      md: 24,
    },
  },
  extensions: {
    brand: {
      meta: { className: "BrandColors", getter: "brand" },
      fields: {
        accent: { light: "#FF6B00", dark: "#FFB74D" },
      },
    },
  },
};

// ─── Tailwind v4 CSS ─────────────────────────────────────────────────────────

describe("generateTailwindCSS", () => {
  const css = generateTailwindCSS(FIXTURE_TOKENS);

  test("uses @theme directive", () => {
    expect(css).toContain("@theme {");
  });

  test("generates color custom properties", () => {
    expect(css).toContain("--color-primary: #6750A4;");
    expect(css).toContain("--color-on-primary: #FFFFFF;");
    expect(css).toContain("--color-surface: #FEF7FF;");
  });

  test("generates spacing custom properties", () => {
    expect(css).toContain("--spacing-xs: 4px;");
    expect(css).toContain("--spacing-md: 16px;");
  });

  test("generates radius custom properties", () => {
    expect(css).toContain("--radius-sm: 4px;");
    expect(css).toContain("--radius-full: 9999px;");
  });

  test("generates icon size custom properties", () => {
    expect(css).toContain("--size-icon-sm: 16px;");
  });

  test("generates extension colors", () => {
    expect(css).toContain("--color-brand-accent: #FF6B00;");
  });

  test("includes dark theme via media query", () => {
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("--color-primary: #D0BCFF;");
  });

  test("includes GENERATED header", () => {
    expect(css).toContain("GENERATED");
  });
});

// ─── Tailwind TS constants ───────────────────────────────────────────────────

describe("generateTailwindTS", () => {
  const ts = generateTailwindTS(FIXTURE_TOKENS);

  test("generates DSSpacing constant", () => {
    expect(ts).toContain("export const DSSpacing = {");
    expect(ts).toContain("xs: 4,");
  });

  test("generates DSRadius constant", () => {
    expect(ts).toContain("export const DSRadius = {");
    expect(ts).toContain("sm: 4,");
  });

  test("generates DSIconSize constant", () => {
    expect(ts).toContain("export const DSIconSize = {");
    expect(ts).toContain("sm: 16,");
  });
});

// ─── Bootstrap SCSS ──────────────────────────────────────────────────────────

describe("generateBootstrapScss", () => {
  const scss = generateBootstrapScss(FIXTURE_TOKENS);

  test("generates color SCSS variables", () => {
    expect(scss).toContain("$primary: #6750A4;");
    expect(scss).toContain("$on-primary: #FFFFFF;");
  });

  test("generates spacing SCSS variables", () => {
    expect(scss).toContain("$spacing-xs: 4px;");
    expect(scss).toContain("$spacing-lg: 24px;");
  });

  test("generates border radius SCSS variables", () => {
    expect(scss).toContain("$border-radius-sm: 4px;");
    expect(scss).toContain("$border-radius-full: 9999px;");
  });

  test("generates dark theme mixin", () => {
    expect(scss).toContain("@mixin dark-theme {");
    expect(scss).toContain("$primary: #D0BCFF !global;");
  });

  test("generates extension SCSS variables", () => {
    expect(scss).toContain("$brand-accent: #FF6B00;");
  });

  test("includes GENERATED header", () => {
    expect(scss).toContain("GENERATED");
  });
});
