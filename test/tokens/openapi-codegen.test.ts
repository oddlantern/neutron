import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { executeOpenAPICodegen } from "../../src/plugins/builtin/typescript-codegen.js";
import type { ExecutionContext } from "../../src/plugins/types.js";
import type { WorkspaceGraph, WorkspacePackage } from "../../src/graph/types.js";

function makePkg(name: string, path: string): WorkspacePackage {
  return { name, path, ecosystem: "typescript", version: "0.0.0", dependencies: [], localDependencies: [] };
}

function makeGraph(name: string): WorkspaceGraph {
  return { name, root: "", packages: new Map(), bridges: [] };
}

function makeContext(root: string, overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    graph: makeGraph("nextsaga"),
    root,
    packageManager: "bun",
    findEcosystemHandlers: async () => [],
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(import.meta.dir, "..", ".tmp-openapi-" + Date.now());
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true });
  }
});

describe("OpenAPI TS codegen — outputDir scaffolding", () => {
  test("scaffolds package.json with workspace-scoped name", async () => {
    const outputDir = join(tmpDir, "generated", "typescript");
    mkdirSync(outputDir, { recursive: true });

    // Create a minimal openapi spec
    const specPath = join(tmpDir, "openapi.json");
    writeFileSync(specPath, JSON.stringify({ openapi: "3.0.0", info: { title: "Test", version: "1.0" }, paths: {} }), "utf-8");

    const pkg = makePkg("web", "apps/web");
    const context = makeContext(tmpDir, {
      artifactPath: "openapi.json",
      sourceName: "api",
      outputDir,
    });

    // The actual openapi-typescript command will fail (not installed in test env),
    // but the scaffolding should happen before the command runs
    await executeOpenAPICodegen(pkg, tmpDir, context);

    // Check scaffold happened
    const pkgJsonPath = join(outputDir, "package.json");
    expect(existsSync(pkgJsonPath)).toBe(true);

    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    expect(pkgJson.name).toBe("@nextsaga/api");
    expect(pkgJson.types).toBe("api.d.ts");
    expect(pkgJson.private).toBe(true);
  });

  test("strips scope from source name", async () => {
    const outputDir = join(tmpDir, "generated", "typescript");
    mkdirSync(outputDir, { recursive: true });

    writeFileSync(join(tmpDir, "openapi.json"), "{}", "utf-8");

    const pkg = makePkg("web", "apps/web");
    const context = makeContext(tmpDir, {
      artifactPath: "openapi.json",
      sourceName: "@nextsaga/api",
      outputDir,
    });

    await executeOpenAPICodegen(pkg, tmpDir, context);

    const pkgJson = JSON.parse(readFileSync(join(outputDir, "package.json"), "utf-8"));
    expect(pkgJson.name).toBe("@nextsaga/api");
  });
});

describe("OpenAPI Dart codegen — outputDir scaffolding", () => {
  test("scaffolds pubspec.yaml with workspace-scoped name", async () => {
    // dart pub get may take a while or fail — we only test scaffolding
    const { executeOpenAPIDartGeneration } = await import(
      "../../src/plugins/builtin/dart/openapi-codegen.js"
    );

    const outputDir = join(tmpDir, "generated", "dart");
    mkdirSync(outputDir, { recursive: true });

    writeFileSync(join(tmpDir, "openapi.json"), JSON.stringify({ openapi: "3.0.0", info: { title: "Test", version: "1.0" }, paths: {} }), "utf-8");

    const pkg: WorkspacePackage = {
      name: "flutter",
      path: "apps/flutter",
      ecosystem: "dart",
      version: "0.0.0",
      dependencies: [],
      localDependencies: [],
    };

    const context = makeContext(tmpDir, {
      artifactPath: "openapi.json",
      sourceName: "api",
      outputDir,
    });

    // Will fail at dart pub get, but scaffold should happen before that
    const result = await executeOpenAPIDartGeneration(pkg, tmpDir, context);
    // Result may fail (dart pub get) but scaffold is what we're testing

    const pubspecPath = join(outputDir, "pubspec.yaml");
    expect(existsSync(pubspecPath)).toBe(true);

    const pubspec = readFileSync(pubspecPath, "utf-8");
    expect(pubspec).toContain("name: nextsaga_api");
    expect(pubspec).toContain("publish_to: none");
    expect(pubspec).toContain("swagger_parser");

    // swagger_parser.yaml should be created
    const swaggerConfig = join(outputDir, "swagger_parser.yaml");
    expect(existsSync(swaggerConfig)).toBe(true);
  }, 30_000);
});
