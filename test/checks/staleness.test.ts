import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { checkStaleness } from "@/checks/staleness";
import type { Bridge, WorkspaceGraph, WorkspacePackage } from "@/graph/types";

let tmpDir: string;

function makePkg(name: string, path: string, eco: string): WorkspacePackage {
  return { name, path, ecosystem: eco, version: "0.0.0", dependencies: [], localDependencies: [] };
}

function makeGraph(bridges: Bridge[], packages: WorkspacePackage[]): WorkspaceGraph {
  const map = new Map<string, WorkspacePackage>();
  for (const pkg of packages) {
    map.set(pkg.path, pkg);
  }
  return { name: "test", root: tmpDir, packages: map, bridges };
}

beforeEach(() => {
  tmpDir = join(import.meta.dir, "..", ".tmp-staleness-" + Date.now());
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true });
  }
});

describe("checkStaleness", () => {
  test("passes with no bridges", async () => {
    const graph = makeGraph([], []);
    const result = await checkStaleness(graph, tmpDir);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test("warns when generated dir is missing", async () => {
    const bridge: Bridge = {
      source: "packages/design",
      consumers: [{ path: "apps/flutter" }],
      artifact: "tokens.json",
      run: undefined,
      watch: undefined,
      entryFile: undefined,
      specPath: undefined,
      exclude: undefined,
    };
    const graph = makeGraph([bridge], [
      makePkg("design", "packages/design", "typescript"),
      makePkg("flutter", "apps/flutter", "dart"),
    ]);

    const result = await checkStaleness(graph, tmpDir);
    expect(result.passed).toBe(true); // warnings don't fail
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]?.message).toContain("missing");
  });

  test("passes when generated dir exists", async () => {
    mkdirSync(join(tmpDir, "packages/design/generated/dart"), { recursive: true });

    const bridge: Bridge = {
      source: "packages/design",
      consumers: [{ path: "apps/flutter" }],
      artifact: "tokens.json",
      run: undefined,
      watch: undefined,
      entryFile: undefined,
      specPath: undefined,
      exclude: undefined,
    };
    const graph = makeGraph([bridge], [
      makePkg("design", "packages/design", "typescript"),
      makePkg("flutter", "apps/flutter", "dart"),
    ]);

    const result = await checkStaleness(graph, tmpDir);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test("checks each consumer ecosystem independently", async () => {
    mkdirSync(join(tmpDir, "packages/design/generated/dart"), { recursive: true });
    // typescript dir missing

    const bridge: Bridge = {
      source: "packages/design",
      consumers: [{ path: "apps/flutter" }, { path: "apps/web" }],
      artifact: "tokens.json",
      run: undefined,
      watch: undefined,
      entryFile: undefined,
      specPath: undefined,
      exclude: undefined,
    };
    const graph = makeGraph([bridge], [
      makePkg("design", "packages/design", "typescript"),
      makePkg("flutter", "apps/flutter", "dart"),
      makePkg("web", "apps/web", "typescript"),
    ]);

    const result = await checkStaleness(graph, tmpDir);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain("typescript");
  });
});
