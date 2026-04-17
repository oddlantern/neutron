import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { WorkspacePackage } from "@/graph/types";
import type { ValidatedTokens } from "@/plugins/builtin/domain/design/types";
import {
  executeTokenGeneration,
  generateTokensModule,
} from "@/plugins/builtin/ecosystem/python/token-codegen";
import type { ExecutionContext } from "@/plugins/types";

// Design tokens drive the UI across ecosystems — a broken generator
// breaks every Python consumer that imports from the generated module.
// Test the structure of the output, not just that "it runs."

function makeTokens(overrides?: Partial<ValidatedTokens>): ValidatedTokens {
  const base: ValidatedTokens = {
    standard: {
      brand: {},
      color: {
        primary: { light: "#0066ff", dark: "#4488ff" },
        accentColor: { light: "#ff6600", dark: "#ffaa44" },
      },
      spacing: { xs: 4, sm: 8, md: 16 },
      radius: { sm: 4, lg: 24, full: 9999 },
      elevation: {},
      shadowCard: undefined,
      iconSize: { sm: 16, md: 24 },
      typography: undefined,
    },
    extensions: {},
  };
  return { ...base, ...overrides };
}

function makePkg(): WorkspacePackage {
  return {
    name: "py-tokens",
    path: "packages/py-tokens",
    ecosystem: "python",
    version: "1.0.0",
    dependencies: [],
    localDependencies: [],
  };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-py-tok-"));
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

describe("generateTokensModule — structure", () => {
  test("emits ColorLight and ColorDark dataclasses with snake_case fields", () => {
    const output = generateTokensModule(makeTokens());
    expect(output).toContain("class ColorLight:");
    expect(output).toContain("class ColorDark:");
    // camelCase → snake_case
    expect(output).toContain("accent_color: str");
    // Default values wired from the theme
    expect(output).toContain('primary: str = "#0066ff"');
    expect(output).toContain('primary: str = "#4488ff"');
  });

  test("uses @dataclass(frozen=True) for immutability", () => {
    const output = generateTokensModule(makeTokens());
    // Count must be positive — multiple classes carry the decorator
    const matches = output.match(/@dataclass\(frozen=True\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2); // ColorLight + ColorDark
  });

  test("spacing/radius/iconSize emit integer annotations", () => {
    const output = generateTokensModule(makeTokens());
    expect(output).toContain("class Spacing:");
    expect(output).toContain("xs: int = 4");
    expect(output).toContain("class Radius:");
    expect(output).toContain("sm: int = 4");
    expect(output).toContain("class IconSize:");
  });

  test("radius values >= 9999 annotate as float (pill/full)", () => {
    const output = generateTokensModule(makeTokens());
    // 9999 is the "full" threshold — float annotation signals the pill shape
    expect(output).toContain("full: float = 9999");
  });

  test("extensions produce a base class plus light/dark subclasses", () => {
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
    expect(output).toContain("class GenreColors:");
    expect(output).toContain("class GenreColorsLight(GenreColors):");
    expect(output).toContain("class GenreColorsDark(GenreColors):");
    expect(output).toContain('fantasy: str = "#aabbcc"');
    expect(output).toContain('horror: str = "#880000"');
  });

  test("omits section classes when the standard section is empty", () => {
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
    expect(output).not.toContain("class ColorLight:");
    expect(output).not.toContain("class Spacing:");
    expect(output).not.toContain("class Radius:");
    expect(output).not.toContain("class IconSize:");
  });
});

describe("executeTokenGeneration — file output", () => {
  test("writes tokens.py and pyproject.toml to outputDir", () => {
    const outDir = join(root, "generated", "python");
    const result = executeTokenGeneration(
      makePkg(),
      root,
      makeContext(outDir, makeTokens(), "design-system"),
    );
    expect(result.success).toBe(true);
    expect(existsSync(join(outDir, "tokens.py"))).toBe(true);
    expect(existsSync(join(outDir, "pyproject.toml"))).toBe(true);

    const pyproject = readFileSync(join(outDir, "pyproject.toml"), "utf-8");
    expect(pyproject).toContain('name = "ws_design-system"');
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

  test("leaves an existing pyproject.toml untouched", () => {
    const outDir = join(root, "out");
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(outDir, { recursive: true });
    const customPyproject = '[project]\nname = "user-owned"\nversion = "1.2.3"\n';
    writeFileSync(join(outDir, "pyproject.toml"), customPyproject, "utf-8");

    executeTokenGeneration(makePkg(), root, makeContext(outDir, makeTokens()));
    const content = readFileSync(join(outDir, "pyproject.toml"), "utf-8");
    expect(content).toBe(customPyproject);
  });
});
