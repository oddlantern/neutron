import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { validateTokens } from "../../src/plugins/builtin/design/token-schema.js";
import type { ValidatedTokens } from "../../src/plugins/builtin/design/types.js";
import { executeDesignTokenGeneration } from "../../src/plugins/builtin/typescript-codegen.js";
import type { ExecutionContext } from "../../src/plugins/types.js";
import type { WorkspaceGraph, WorkspacePackage } from "../../src/graph/types.js";

const FIXTURE_PATH = join(import.meta.dir, "..", "fixture-tokens", "tokens.json");

function loadTokens(): ValidatedTokens {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
  const result = validateTokens(raw);
  if (!result.data) {
    throw new Error(`Fixture tokens invalid: ${result.errors.map((e) => e.message).join(", ")}`);
  }
  return result.data;
}

function makePackage(name: string, path: string): WorkspacePackage {
  return {
    name,
    path,
    ecosystem: "typescript",
    version: "0.0.0",
    dependencies: [],
    localDependencies: [],
  };
}

function makeGraph(name: string, packages: WorkspacePackage[]): WorkspaceGraph {
  const map = new Map<string, WorkspacePackage>();
  for (const pkg of packages) {
    map.set(pkg.path, pkg);
  }
  return { name, root: "", packages: map, bridges: [] };
}

function makeContext(
  graph: WorkspaceGraph,
  root: string,
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  return {
    graph,
    root,
    packageManager: "bun",
    findEcosystemHandlers: async () => [],
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(import.meta.dir, "..", ".tmp-naming-" + Date.now());
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true });
  }
});

describe("generated package naming — TypeScript", () => {
  test("names package as @workspace/source-name", async () => {
    const outputDir = join(tmpDir, "generated", "typescript");
    mkdirSync(outputDir, { recursive: true });

    const pkg = makePackage("consumer-app", "apps/web");
    const graph = makeGraph("nextsaga", [
      pkg,
      makePackage("design-system", "packages/design-system"),
    ]);

    const context = makeContext(graph, tmpDir, {
      domainData: loadTokens(),
      sourceName: "design-system",
      outputDir,
    });

    const result = await executeDesignTokenGeneration(pkg, tmpDir, context);
    expect(result.success).toBe(true);

    const pkgJson = JSON.parse(readFileSync(join(outputDir, "package.json"), "utf-8"));
    expect(pkgJson.name).toBe("@nextsaga/design-system");
  });

  test("strips npm scope from source name", async () => {
    const outputDir = join(tmpDir, "generated", "typescript");
    mkdirSync(outputDir, { recursive: true });

    const pkg = makePackage("consumer-app", "apps/web");
    const graph = makeGraph("nextsaga", [pkg]);

    const context = makeContext(graph, tmpDir, {
      domainData: loadTokens(),
      sourceName: "@nextsaga/api",
      outputDir,
    });

    const result = await executeDesignTokenGeneration(pkg, tmpDir, context);
    expect(result.success).toBe(true);

    const pkgJson = JSON.parse(readFileSync(join(outputDir, "package.json"), "utf-8"));
    expect(pkgJson.name).toBe("@nextsaga/api");
  });

  test("uses source name without workspace when workspace is empty", async () => {
    const outputDir = join(tmpDir, "generated", "typescript");
    mkdirSync(outputDir, { recursive: true });

    const pkg = makePackage("consumer", "apps/web");
    const graph = makeGraph("", [pkg]);

    const context = makeContext(graph, tmpDir, {
      domainData: loadTokens(),
      sourceName: "design-system",
      outputDir,
    });

    const result = await executeDesignTokenGeneration(pkg, tmpDir, context);
    expect(result.success).toBe(true);

    const pkgJson = JSON.parse(readFileSync(join(outputDir, "package.json"), "utf-8"));
    expect(pkgJson.name).toBe("design-system");
  });

  test("falls back to 'generated' when no source name", async () => {
    const outputDir = join(tmpDir, "generated", "typescript");
    mkdirSync(outputDir, { recursive: true });

    const pkg = makePackage("consumer", "apps/web");
    const graph = makeGraph("myworkspace", [pkg]);

    const context = makeContext(graph, tmpDir, {
      domainData: loadTokens(),
      outputDir,
    });

    const result = await executeDesignTokenGeneration(pkg, tmpDir, context);
    expect(result.success).toBe(true);

    const pkgJson = JSON.parse(readFileSync(join(outputDir, "package.json"), "utf-8"));
    expect(pkgJson.name).toBe("@myworkspace/generated");
  });
});

describe("generated package naming — Dart", () => {
  // Import dart plugin dynamically to avoid pulling in all dart deps at top level
  test("names package as workspace_source_name", async () => {
    const { dartPlugin } = await import("../../src/plugins/builtin/dart.js");

    const outputDir = join(tmpDir, "generated", "dart");
    mkdirSync(outputDir, { recursive: true });

    const pkg = makePackage("flutter-app", "apps/flutter");
    const dartPkg: WorkspacePackage = { ...pkg, ecosystem: "dart" };
    const graph = makeGraph("nextsaga", [
      dartPkg,
      makePackage("design-system", "packages/design-system"),
    ]);

    const context = makeContext(graph, tmpDir, {
      domainData: loadTokens(),
      sourceName: "design-system",
      outputDir,
    });

    const result = await dartPlugin.execute(
      "generate-design-tokens",
      dartPkg,
      tmpDir,
      context,
    );
    expect(result.success).toBe(true);

    const pubspec = readFileSync(join(outputDir, "pubspec.yaml"), "utf-8");
    expect(pubspec).toContain("name: nextsaga_design_system");
  });

  test("sanitizes scoped source names for dart", async () => {
    const { dartPlugin } = await import("../../src/plugins/builtin/dart.js");

    const outputDir = join(tmpDir, "generated", "dart");
    mkdirSync(outputDir, { recursive: true });

    const pkg = makePackage("flutter-app", "apps/flutter");
    const dartPkg: WorkspacePackage = { ...pkg, ecosystem: "dart" };
    const graph = makeGraph("nextsaga", [dartPkg]);

    const context = makeContext(graph, tmpDir, {
      domainData: loadTokens(),
      sourceName: "@nextsaga/api",
      outputDir,
    });

    const result = await dartPlugin.execute(
      "generate-design-tokens",
      dartPkg,
      tmpDir,
      context,
    );
    expect(result.success).toBe(true);

    const pubspec = readFileSync(join(outputDir, "pubspec.yaml"), "utf-8");
    expect(pubspec).toContain("name: nextsaga_api");
  });
});
