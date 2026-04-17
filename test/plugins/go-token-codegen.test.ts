import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { WorkspacePackage } from "@/graph/types";
import type { ValidatedTokens } from "@/plugins/builtin/domain/design/types";
import {
  executeTokenGeneration,
  generateTokensModule,
} from "@/plugins/builtin/ecosystem/go/token-codegen";
import type { ExecutionContext } from "@/plugins/types";

// Go codegen assertions cover the idiom choices — PascalCase fields
// for export, const blocks with prefixed names (Go has no namespace),
// var (not const) for themed struct instances — and the scaffolded
// go.mod output. A real `go build` check lives in go-codegen-compile.

function makeTokens(overrides?: Partial<ValidatedTokens>): ValidatedTokens {
  return {
    standard: {
      brand: {},
      color: {
        primary: { light: "#0066ff", dark: "#4488ff" },
        accentColor: { light: "#ff6600", dark: "#ffaa44" },
      },
      spacing: { xs: 4, mdLarge: 24 },
      radius: { sm: 4 },
      elevation: {},
      shadowCard: undefined,
      iconSize: { md: 24 },
      typography: undefined,
    },
    extensions: {},
    ...overrides,
  };
}

function makePkg(): WorkspacePackage {
  return {
    name: "go-tokens",
    path: "packages/go-tokens",
    ecosystem: "go",
    version: "1.0.0",
    dependencies: [],
    localDependencies: [],
  };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-go-tok-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeContext(outputDir: string, tokens: ValidatedTokens, name = "tokens"): ExecutionContext {
  return {
    graph: { name: "ws", root, packages: new Map(), bridges: [] },
    packageManager: "bun",
    root,
    findEcosystemHandlers: async () => [],
    domainData: tokens,
    outputDir,
    sourceName: name,
  };
}

describe("generateTokensModule — Go idioms", () => {
  test("declares `package tokens` and emits Color struct with PascalCase fields", () => {
    const output = generateTokensModule(makeTokens());
    expect(output).toContain("package tokens");
    expect(output).toContain("type Color struct {");
    // camelCase → PascalCase for Go export
    expect(output).toContain("Primary");
    expect(output).toContain("AccentColor");
  });

  test("themed color instances use `var` (not const) — Go can't const a struct", () => {
    const output = generateTokensModule(makeTokens());
    expect(output).toContain("var ColorLight = Color{");
    expect(output).toContain("var ColorDark = Color{");
    // Color light/dark values wired through to the struct literals.
    // Don't assert padding whitespace — gofmt idiom is tested
    // end-to-end by go-codegen-compile.
    expect(output).toContain('"#0066ff"');
    expect(output).toContain('"#4488ff"');
  });

  test("scalar sections emit `const (...)` blocks with prefixed PascalCase names", () => {
    // Go has no nested namespaces like Rust's `pub mod`; consts live
    // at package scope, so the section name is folded into each const.
    const output = generateTokensModule(makeTokens());
    expect(output).toContain("const (");
    expect(output).toContain("SpacingXs");
    // camelCase keys → PascalCase with underscore boundaries preserved
    expect(output).toContain("SpacingMdLarge");
    expect(output).toContain("RadiusSm");
    expect(output).toContain("IconSizeMd");
  });

  test("scalar consts are typed uint32 for interop", () => {
    const output = generateTokensModule(makeTokens());
    expect(output).toMatch(/SpacingXs\s+uint32\s*=\s*4/);
  });

  test("extensions produce struct + LightDark vars per section", () => {
    const tokens = makeTokens({
      extensions: {
        genres: {
          meta: { className: "GenreColors", getter: "genres" },
          fields: {
            fantasy: { light: "#aabbcc", dark: "#112233" },
            horror: { light: "#cc0000", dark: "#880000" },
          },
        },
      },
    });
    const output = generateTokensModule(tokens);
    expect(output).toContain("type GenreColors struct {");
    expect(output).toContain("var GenreColorsLight = GenreColors{");
    expect(output).toContain("var GenreColorsDark = GenreColors{");
    // Values present (alignment/padding is a gofmt concern — verified
    // end-to-end by go-codegen-compile).
    expect(output).toContain('"#aabbcc"');
    expect(output).toContain('"#880000"');
  });

  test("omits sections when the token group is empty", () => {
    const tokens = makeTokens({
      standard: {
        brand: {},
        color: {},
        spacing: {},
        radius: {},
        elevation: {},
        shadowCard: undefined,
        iconSize: {},
        typography: undefined,
      },
    });
    const output = generateTokensModule(tokens);
    expect(output).not.toContain("type Color struct");
    expect(output).not.toContain("const (");
    // Package declaration + header only.
    expect(output).toContain("package tokens");
  });
});

describe("executeTokenGeneration — file output", () => {
  test("writes tokens.go + go.mod into outputDir", () => {
    const outDir = join(root, "generated", "go");
    const result = executeTokenGeneration(
      makePkg(),
      root,
      makeContext(outDir, makeTokens(), "design-system"),
    );
    expect(result.success).toBe(true);
    expect(existsSync(join(outDir, "tokens.go"))).toBe(true);
    expect(existsSync(join(outDir, "go.mod"))).toBe(true);

    const goMod = readFileSync(join(outDir, "go.mod"), "utf-8");
    // module path is workspace/sourceName
    expect(goMod).toContain("module ws/design-system");
    expect(goMod).toContain("go 1.21");
  });

  test("sanitizes module path — no characters Go rejects", () => {
    const outDir = join(root, "out");
    const ctx = makeContext(outDir, makeTokens(), "@scope/my client");
    executeTokenGeneration(makePkg(), root, ctx);
    const goMod = readFileSync(join(outDir, "go.mod"), "utf-8");
    // @, spaces disallowed in Go module paths. `/` and `-` stay.
    expect(goMod).not.toMatch(/module\s+[^\n]*[ @]/);
  });

  test("leaves an existing go.mod untouched", () => {
    const outDir = join(root, "out");
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(outDir, { recursive: true });
    const custom = "module example.com/user-owned\n\ngo 1.22\n";
    writeFileSync(join(outDir, "go.mod"), custom, "utf-8");

    executeTokenGeneration(makePkg(), root, makeContext(outDir, makeTokens()));
    expect(readFileSync(join(outDir, "go.mod"), "utf-8")).toBe(custom);
  });

  test("fails with clear message when domainData is missing", () => {
    const ctx: ExecutionContext = {
      graph: { name: "ws", root, packages: new Map(), bridges: [] },
      packageManager: "bun",
      root,
      findEcosystemHandlers: async () => [],
      outputDir: join(root, "out"),
    };
    const result = executeTokenGeneration(makePkg(), root, ctx);
    expect(result.success).toBe(false);
    expect(result.summary).toContain("validated tokens");
  });

  test("fails with clear message when outputDir is missing", () => {
    const ctx: ExecutionContext = {
      graph: { name: "ws", root, packages: new Map(), bridges: [] },
      packageManager: "bun",
      root,
      findEcosystemHandlers: async () => [],
      domainData: makeTokens(),
    };
    const result = executeTokenGeneration(makePkg(), root, ctx);
    expect(result.success).toBe(false);
    expect(result.summary).toContain("outputDir");
  });
});
