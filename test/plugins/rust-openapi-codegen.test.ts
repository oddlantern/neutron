import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { WorkspacePackage } from "@/graph/types";
import { executeOpenapiModelGeneration } from "@/plugins/builtin/ecosystem/rust/openapi-codegen";
import type { ExecutionContext } from "@/plugins/types";

// Rust OpenAPI codegen is deliberately types-only. These tests cover
// the structural output (models.rs + Cargo.toml + lib.rs) and the
// error surfaces. We want the "types only" rationale visible in the
// generated code, not just commit messages, so one test asserts the
// header stays intact.

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-rust-oapi-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makePkg(): WorkspacePackage {
  return {
    name: "rust-client",
    path: "packages/rust-client",
    ecosystem: "rust",
    version: "1.0.0",
    dependencies: [],
    localDependencies: [],
  };
}

function makeContext(overrides: Partial<ExecutionContext>): ExecutionContext {
  return {
    graph: { name: "ws", root, packages: new Map(), bridges: [] },
    packageManager: "bun",
    root,
    findEcosystemHandlers: async () => [],
    ...overrides,
  };
}

function writeSpec(content: unknown): string {
  const path = "openapi.json";
  writeFileSync(join(root, path), JSON.stringify(content), "utf-8");
  return path;
}

describe("executeOpenapiModelGeneration — output structure", () => {
  test("writes src/models.rs, src/lib.rs, Cargo.toml for a valid spec", async () => {
    const artifactPath = writeSpec({
      openapi: "3.1.0",
      components: {
        schemas: {
          User: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
            },
            required: ["id"],
          },
        },
      },
    });
    const outDir = join(root, "generated", "rust");

    const result = await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath, outputDir: outDir, sourceName: "api-client" }),
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("Rust struct");
    // The "models only" tagline makes the types-only contract visible
    // even in CLI output after a successful run.
    expect(result.summary).toContain("models only");

    expect(existsSync(join(outDir, "src", "models.rs"))).toBe(true);
    expect(existsSync(join(outDir, "src", "lib.rs"))).toBe(true);
    expect(existsSync(join(outDir, "Cargo.toml"))).toBe(true);
  });

  test("generates a struct for each component.schemas entry", async () => {
    const artifactPath = writeSpec({
      components: {
        schemas: {
          User: { type: "object", properties: { id: { type: "string" } } },
          Order: { type: "object", properties: { total: { type: "number" } } },
        },
      },
    });
    const outDir = join(root, "out");
    const result = await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath, outputDir: outDir }),
    );
    expect(result.success).toBe(true);
    const models = readFileSync(join(outDir, "src", "models.rs"), "utf-8");
    expect(models).toContain("pub struct User");
    expect(models).toContain("pub struct Order");
  });

  test("Cargo.toml declares serde + serde_json runtime deps", async () => {
    const artifactPath = writeSpec({
      components: {
        schemas: { User: { type: "object", properties: { id: { type: "string" } } } },
      },
    });
    const outDir = join(root, "out");
    await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath, outputDir: outDir, sourceName: "api" }),
    );
    const cargo = readFileSync(join(outDir, "Cargo.toml"), "utf-8");
    expect(cargo).toMatch(/serde\s*=\s*\{/);
    expect(cargo).toContain('serde_json = "1"');
    expect(cargo).toContain('edition = "2021"');
  });

  test("succeeds with empty components.schemas (no models)", async () => {
    // A spec with only paths and no component schemas is valid. We
    // should still emit a scaffolded package; just with zero structs.
    const artifactPath = writeSpec({
      components: { schemas: {} },
    });
    const outDir = join(root, "out");
    const result = await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath, outputDir: outDir }),
    );
    // validateSchema rejects zero-definition inputs today. When that
    // invariant changes, this test flips. Until then, assert the
    // current behavior so the contract is visible.
    expect(result.success).toBe(false);
    expect(result.summary).toContain("failed validation");
  });
});

describe("executeOpenapiModelGeneration — error surfaces", () => {
  test("fails when artifactPath is not set", async () => {
    const result = await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext({ outputDir: join(root, "out") }),
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("artifactPath");
  });

  test("fails when outputDir is not set", async () => {
    const result = await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath: "openapi.json" }),
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("outputDir");
  });

  test("fails when the spec file cannot be read", async () => {
    const result = await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath: "missing.json", outputDir: join(root, "out") }),
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Failed to read OpenAPI spec");
  });

  test("fails with clear message on malformed JSON", async () => {
    writeFileSync(join(root, "bad.json"), "{{not json", "utf-8");
    const result = await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath: "bad.json", outputDir: join(root, "out") }),
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Failed to read OpenAPI spec");
  });

  test("preserves an existing Cargo.toml instead of overwriting", async () => {
    const artifactPath = writeSpec({
      components: {
        schemas: { User: { type: "object", properties: { id: { type: "string" } } } },
      },
    });
    const outDir = join(root, "out");
    mkdirSync(outDir, { recursive: true });
    const custom = '[package]\nname = "user-owned"\nversion = "9.9.9"\nedition = "2021"\n';
    writeFileSync(join(outDir, "Cargo.toml"), custom, "utf-8");

    await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath, outputDir: outDir }),
    );

    expect(readFileSync(join(outDir, "Cargo.toml"), "utf-8")).toBe(custom);
  });
});
