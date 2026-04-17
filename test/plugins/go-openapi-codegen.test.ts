import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { WorkspacePackage } from "@/graph/types";
import { executeOpenapiModelGeneration } from "@/plugins/builtin/ecosystem/go/openapi-codegen";
import type { ExecutionContext } from "@/plugins/types";

// Go OpenAPI codegen is types-only, matching the Rust implementation.
// Structural tests cover the output layout and error surfaces; the
// `go build` end-to-end check lives in go-codegen-compile.

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-go-oapi-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makePkg(): WorkspacePackage {
  return {
    name: "go-client",
    path: "packages/go-client",
    ecosystem: "go",
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

describe("executeOpenapiModelGeneration — Go output structure", () => {
  test("writes models.go and go.mod into outputDir", async () => {
    const artifactPath = writeSpec({
      components: {
        schemas: {
          User: { type: "object", properties: { id: { type: "string" } } },
        },
      },
    });
    const outDir = join(root, "out");

    const result = await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath, outputDir: outDir, sourceName: "api" }),
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Go struct");
    // Types-only signal in the CLI output — mirrors the Rust
    // implementation's contract.
    expect(result.summary).toContain("models only");

    expect(existsSync(join(outDir, "models.go"))).toBe(true);
    expect(existsSync(join(outDir, "go.mod"))).toBe(true);
  });

  test("emits `package models` (not the schema-codegen default `package schema`)", async () => {
    const artifactPath = writeSpec({
      components: { schemas: { User: { type: "object", properties: { id: { type: "string" } } } } },
    });
    const outDir = join(root, "out");
    await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath, outputDir: outDir }),
    );
    const models = readFileSync(join(outDir, "models.go"), "utf-8");
    expect(models).toContain("package models");
    expect(models).not.toContain("package schema");
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
    const models = readFileSync(join(outDir, "models.go"), "utf-8");
    expect(models).toContain("type User struct");
    expect(models).toContain("type Order struct");
  });

  test("go.mod declares no runtime deps — models use stdlib only", async () => {
    const artifactPath = writeSpec({
      components: { schemas: { U: { type: "object", properties: { id: { type: "string" } } } } },
    });
    const outDir = join(root, "out");
    await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath, outputDir: outDir, sourceName: "api" }),
    );
    const goMod = readFileSync(join(outDir, "go.mod"), "utf-8");
    expect(goMod).toContain("module ws/api");
    expect(goMod).toContain("go 1.21");
    // No require block — the generated models only use stdlib.
    expect(goMod).not.toContain("require");
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

  test("fails on malformed JSON", async () => {
    writeFileSync(join(root, "bad.json"), "{{not json", "utf-8");
    const result = await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath: "bad.json", outputDir: join(root, "out") }),
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Failed to read OpenAPI spec");
  });

  test("preserves an existing go.mod", async () => {
    const artifactPath = writeSpec({
      components: { schemas: { U: { type: "object", properties: { id: { type: "string" } } } } },
    });
    const outDir = join(root, "out");
    mkdirSync(outDir, { recursive: true });
    const custom = "module example.com/user-owned\n\ngo 1.22\n";
    writeFileSync(join(outDir, "go.mod"), custom, "utf-8");

    await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath, outputDir: outDir }),
    );
    expect(readFileSync(join(outDir, "go.mod"), "utf-8")).toBe(custom);
  });
});
