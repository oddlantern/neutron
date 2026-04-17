import { describe, expect, test } from "bun:test";

import {
  extractFormatConfig,
  extractLintConfig,
  mergeMigratedConfig,
  stripJsonComments,
} from "@/commands/migrate";

// migrate owns the transition from standalone oxlint/oxfmt/prettier
// configs into neutron.yml. If these extractors mishandle categories,
// rules, or ignore patterns, users lose configuration silently during
// `neutron init`. Tests cover the pure-logic parts; the interactive
// orchestrator is integration-tested elsewhere via init's CLI flow.

describe("stripJsonComments", () => {
  test("strips single-line comments", () => {
    const input = '{\n  "a": 1, // trailing\n  "b": 2\n}';
    const out = stripJsonComments(input);
    expect(out).not.toContain("// trailing");
    expect(JSON.parse(out)).toEqual({ a: 1, b: 2 });
  });

  test("strips block comments", () => {
    const input = '/* header */\n{"x": 1, /* inline */ "y": 2}';
    const out = stripJsonComments(input);
    expect(out).not.toContain("/*");
    expect(JSON.parse(out)).toEqual({ x: 1, y: 2 });
  });

  test("preserves // inside string values", () => {
    // This is the classic JSONC trap: a URL inside a string value
    // shouldn't be mistaken for a comment.
    const input = '{"url": "https://example.com/path"}';
    const out = stripJsonComments(input);
    expect(JSON.parse(out)).toEqual({ url: "https://example.com/path" });
  });

  test("preserves escaped quotes inside strings", () => {
    const input = '{"message": "He said \\"hi\\""}';
    const out = stripJsonComments(input);
    expect(JSON.parse(out)).toEqual({ message: 'He said "hi"' });
  });

  test("handles multi-line block comments that span JSON structure", () => {
    const input =
      '{\n/*\n  multi\n  line\n  comment\n*/\n  "a": 1\n}';
    const out = stripJsonComments(input);
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });
});

describe("extractLintConfig", () => {
  test("produces empty object when nothing is extractable", () => {
    expect(extractLintConfig({})).toEqual({});
    expect(extractLintConfig({ unrelated: "value" })).toEqual({});
  });

  test("wraps categories into typescript ecosystem section", () => {
    const out = extractLintConfig({
      categories: { correctness: "error", suspicious: "warn" },
    });
    expect(out).toEqual({
      typescript: { categories: { correctness: "error", suspicious: "warn" } },
    });
  });

  test("wraps rules into typescript ecosystem section", () => {
    const out = extractLintConfig({
      rules: { "no-console": "off", "prefer-const": "error" },
    });
    expect(out).toEqual({
      typescript: { rules: { "no-console": "off", "prefer-const": "error" } },
    });
  });

  test("combines categories + rules under a single typescript section", () => {
    const out = extractLintConfig({
      categories: { perf: "warn" },
      rules: { "no-unused-vars": "error" },
    });
    expect(out).toEqual({
      typescript: {
        categories: { perf: "warn" },
        rules: { "no-unused-vars": "error" },
      },
    });
  });

  test("lifts ignorePatterns to top-level ignore (not ecosystem-scoped)", () => {
    // ignore applies across ecosystems, so it sits at lint.ignore
    // rather than lint.typescript.ignore.
    const out = extractLintConfig({
      ignorePatterns: ["dist/**", "node_modules/**"],
    });
    expect(out).toEqual({ ignore: ["dist/**", "node_modules/**"] });
  });

  test("combines typescript section + top-level ignore", () => {
    const out = extractLintConfig({
      categories: { style: "off" },
      ignorePatterns: ["build/**"],
    });
    expect(out).toEqual({
      typescript: { categories: { style: "off" } },
      ignore: ["build/**"],
    });
  });

  test("ignores empty categories / rules objects", () => {
    // Empty objects shouldn't produce a typescript key — that would
    // create noise in the generated neutron.yml.
    expect(extractLintConfig({ categories: {} })).toEqual({});
    expect(extractLintConfig({ rules: {} })).toEqual({});
    expect(extractLintConfig({ categories: {}, rules: {} })).toEqual({});
  });

  test("ignores empty ignorePatterns", () => {
    expect(extractLintConfig({ ignorePatterns: [] })).toEqual({});
  });

  test("ignores non-record / non-array fields", () => {
    // Malformed values shouldn't crash or leak through.
    expect(extractLintConfig({ categories: "invalid" })).toEqual({});
    expect(extractLintConfig({ rules: 42 })).toEqual({});
    expect(extractLintConfig({ ignorePatterns: "not-an-array" })).toEqual({});
  });
});

describe("extractFormatConfig", () => {
  test("produces empty object for empty input", () => {
    expect(extractFormatConfig({})).toEqual({});
  });

  test("wraps every formatting option under typescript ecosystem section", () => {
    const out = extractFormatConfig({
      printWidth: 100,
      semi: true,
      singleQuote: true,
      trailingComma: "all",
    });
    expect(out).toEqual({
      typescript: {
        printWidth: 100,
        semi: true,
        singleQuote: true,
        trailingComma: "all",
      },
    });
  });

  test("filters $schema metadata keys — they aren't formatting options", () => {
    const out = extractFormatConfig({
      $schema: "https://json.schemastore.org/prettierrc",
      printWidth: 120,
    });
    expect(out).toEqual({ typescript: { printWidth: 120 } });
  });

  test("returns empty when only metadata keys are present", () => {
    expect(extractFormatConfig({ $schema: "https://..." })).toEqual({});
  });
});

describe("mergeMigratedConfig", () => {
  test("no-op when migrated has no lint or format", () => {
    const config: Record<string, unknown> = { workspace: "test" };
    mergeMigratedConfig(config, {});
    expect(config).toEqual({ workspace: "test" });
  });

  test("attaches lint section when none exists in config", () => {
    const config: Record<string, unknown> = {};
    mergeMigratedConfig(config, {
      lint: { typescript: { categories: { correctness: "error" } } },
    });
    expect(config).toEqual({
      lint: { typescript: { categories: { correctness: "error" } } },
    });
  });

  test("merges typescript subsection fields rather than overwriting", () => {
    // The existing config has default oxlint plugin settings; the
    // migrated config brings categories. Both must survive.
    const config: Record<string, unknown> = {
      lint: {
        typescript: {
          plugins: ["typescript", "unicorn"],
        },
      },
    };
    mergeMigratedConfig(config, {
      lint: {
        typescript: {
          categories: { correctness: "error" },
        },
      },
    });
    expect(config["lint"]).toEqual({
      typescript: {
        plugins: ["typescript", "unicorn"],
        categories: { correctness: "error" },
      },
    });
  });

  test("migrated typescript values override matching existing keys", () => {
    const config: Record<string, unknown> = {
      lint: {
        typescript: { categories: { correctness: "warn" } },
      },
    };
    mergeMigratedConfig(config, {
      lint: {
        typescript: { categories: { correctness: "error" } },
      },
    });
    expect(config["lint"]).toEqual({
      typescript: { categories: { correctness: "error" } },
    });
  });

  test("non-typescript keys (ignore) attach at the lint top level", () => {
    const config: Record<string, unknown> = {
      lint: { typescript: { categories: { style: "off" } } },
    };
    mergeMigratedConfig(config, {
      lint: { ignore: ["dist/**"] },
    });
    expect(config["lint"]).toEqual({
      typescript: { categories: { style: "off" } },
      ignore: ["dist/**"],
    });
  });

  test("format merges follow the same typescript-shallow-merge rules", () => {
    const config: Record<string, unknown> = {
      format: { typescript: { printWidth: 80 } },
    };
    mergeMigratedConfig(config, {
      format: { typescript: { semi: false } },
    });
    expect(config["format"]).toEqual({
      typescript: { printWidth: 80, semi: false },
    });
  });

  test("format.ignore lives at top-level, not nested under typescript", () => {
    const config: Record<string, unknown> = {};
    mergeMigratedConfig(config, {
      format: {
        typescript: { printWidth: 100 },
        ignore: ["generated/**"],
      },
    });
    expect(config["format"]).toEqual({
      typescript: { printWidth: 100 },
      ignore: ["generated/**"],
    });
  });

  test("gracefully handles a non-record existing lint section", () => {
    // Malformed prior state — should be replaced rather than crash.
    const config: Record<string, unknown> = { lint: "not an object" };
    mergeMigratedConfig(config, {
      lint: { typescript: { categories: { correctness: "error" } } },
    });
    expect(config["lint"]).toEqual({
      typescript: { categories: { correctness: "error" } },
    });
  });
});
