import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { WorkspacePackage } from "@/graph/types";
import type { ValidatedTokens } from "@/plugins/builtin/domain/design/types";
import {
  executeTokenGeneration,
  generateTokensModule,
} from "@/plugins/builtin/ecosystem/rust/token-codegen";
import type { ExecutionContext } from "@/plugins/types";

// Rust codegen must produce code that compiles — test the structural
// shape (struct fields, const decls, module layout) so a regression
// doesn't slip past by emitting garbled syntax.

function makeTokens(overrides?: Partial<ValidatedTokens>): ValidatedTokens {
  return {
    standard: {
      brand: {},
      color: {
        primary: { light: "#0066ff", dark: "#4488ff" },
        accentColor: { light: "#ff6600", dark: "#ffaa44" },
      },
      spacing: { xs: 4, sm: 8, mdLarge: 24 },
      radius: { sm: 4, lg: 24 },
      elevation: {},
      shadowCard: undefined,
      iconSize: { sm: 16 },
      typography: undefined,
    },
    extensions: {},
    ...overrides,
  };
}

function makePkg(): WorkspacePackage {
  return {
    name: "rust-tokens",
    path: "packages/rust-tokens",
    ecosystem: "rust",
    version: "1.0.0",
    dependencies: [],
    localDependencies: [],
  };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-rust-tok-"));
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
  test("emits pub struct Color with snake_case fields", () => {
    const output = generateTokensModule(makeTokens());
    expect(output).toContain("pub struct Color {");
    expect(output).toContain("pub primary: &'static str");
    // camelCase → snake_case
    expect(output).toContain("pub accent_color: &'static str");
  });

  test("Color struct has LIGHT and DARK const instances with actual hex values", () => {
    const output = generateTokensModule(makeTokens());
    expect(output).toContain("impl Color {");
    expect(output).toContain("pub const LIGHT: Color = Color {");
    expect(output).toContain("pub const DARK: Color = Color {");
    expect(output).toContain('primary: "#0066ff"');
    expect(output).toContain('primary: "#4488ff"');
  });

  test("scalar sections emit pub mod with SCREAMING_SNAKE_CASE consts", () => {
    const output = generateTokensModule(makeTokens());
    expect(output).toContain("pub mod spacing {");
    expect(output).toContain("pub const XS: u32 = 4");
    // camelCase → SCREAMING_SNAKE_CASE
    expect(output).toContain("pub const MD_LARGE: u32 = 24");
    expect(output).toContain("pub mod radius {");
    expect(output).toContain("pub mod icon_size {");
  });

  test("extensions produce one struct plus LIGHT/DARK consts per section", () => {
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
    expect(output).toContain("pub struct GenreColors {");
    expect(output).toContain("pub fantasy: &'static str");
    expect(output).toContain("impl GenreColors {");
    expect(output).toContain("pub const LIGHT: GenreColors = GenreColors {");
    expect(output).toContain("pub const DARK: GenreColors = GenreColors {");
    expect(output).toContain('fantasy: "#aabbcc"');
    expect(output).toContain('horror: "#880000"');
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
    expect(output).not.toContain("pub struct Color");
    expect(output).not.toContain("pub mod spacing");
    expect(output).not.toContain("pub mod radius");
    expect(output).not.toContain("pub mod icon_size");
  });
});

describe("executeTokenGeneration — file output", () => {
  test("writes src/tokens.rs, src/lib.rs, Cargo.toml into outputDir", () => {
    const outDir = join(root, "generated", "rust");
    const result = executeTokenGeneration(
      makePkg(),
      root,
      makeContext(outDir, makeTokens(), "design-system"),
    );
    expect(result.success).toBe(true);
    expect(existsSync(join(outDir, "src", "tokens.rs"))).toBe(true);
    expect(existsSync(join(outDir, "src", "lib.rs"))).toBe(true);
    expect(existsSync(join(outDir, "Cargo.toml"))).toBe(true);

    const lib = readFileSync(join(outDir, "src", "lib.rs"), "utf-8");
    expect(lib).toContain("pub mod tokens;");
    expect(lib).toContain("pub use tokens::*;");

    const cargo = readFileSync(join(outDir, "Cargo.toml"), "utf-8");
    expect(cargo).toContain('name = "ws_design-system"');
    expect(cargo).toContain('edition = "2021"');
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

  test("leaves an existing Cargo.toml untouched", () => {
    const outDir = join(root, "out");
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(outDir, { recursive: true });
    const custom = '[package]\nname = "user-owned"\nversion = "1.2.3"\nedition = "2021"\n';
    writeFileSync(join(outDir, "Cargo.toml"), custom, "utf-8");

    executeTokenGeneration(makePkg(), root, makeContext(outDir, makeTokens()));
    expect(readFileSync(join(outDir, "Cargo.toml"), "utf-8")).toBe(custom);
  });

  test("sanitizes crate name — no characters that cargo rejects", () => {
    const outDir = join(root, "out");
    const ctx = makeContext(outDir, makeTokens(), "@scope/my client");
    executeTokenGeneration(makePkg(), root, ctx);
    const cargo = readFileSync(join(outDir, "Cargo.toml"), "utf-8");
    // Cargo accepts alphanumerics, underscore, hyphen. @, /, space are out.
    expect(cargo).not.toMatch(/name\s*=\s*"[^"]*[ @/]/);
  });
});
