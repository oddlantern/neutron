import { describe, expect, test } from "bun:test";

// Test the internal logic directly by reimplementing the key functions
// (the actual command reads from git, but we test the mapping/walking logic)

import type { WorkspacePackage, Bridge } from "../../src/graph/types.js";

type GraphPackages = ReadonlyMap<string, WorkspacePackage>;

function makePkg(name: string, path: string, eco: string, localDeps: string[] = []): WorkspacePackage {
  return { name, path, ecosystem: eco, version: "0.0.0", dependencies: [], localDependencies: localDeps };
}

/** Path segments that indicate generated/non-source files */
const IGNORED_SEGMENTS = ["/generated/", "/node_modules/", "/.dart_tool/", "/build/", "/dist/"];

function filesToPackages(
  changedFiles: readonly string[],
  packages: GraphPackages,
): Set<string> {
  const affected = new Set<string>();
  for (const file of changedFiles) {
    if (IGNORED_SEGMENTS.some((seg) => file.includes(seg.slice(1)))) {
      continue;
    }
    for (const [path] of packages) {
      if (file.startsWith(path + "/") || file === path) {
        affected.add(path);
      }
    }
  }
  return affected;
}

function buildReverseDeps(packages: GraphPackages): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const [, pkg] of packages) {
    for (const dep of pkg.localDependencies) {
      const existing = reverse.get(dep);
      if (existing) {
        existing.push(pkg.path);
      } else {
        reverse.set(dep, [pkg.path]);
      }
    }
  }
  return reverse;
}

function buildReverseBridges(
  bridges: readonly Bridge[],
): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const bridge of bridges) {
    const existing = reverse.get(bridge.source);
    const consumers = [...bridge.consumers];
    if (existing) {
      for (const c of consumers) {
        if (!existing.includes(c)) existing.push(c);
      }
    } else {
      reverse.set(bridge.source, consumers);
    }
  }
  return reverse;
}

function walkForward(
  directlyChanged: Set<string>,
  reverseDeps: Map<string, readonly string[]>,
  reverseBridges: Map<string, readonly string[]>,
): Set<string> {
  const affected = new Set<string>(directlyChanged);
  const queue = [...directlyChanged];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const dep of reverseDeps.get(current) ?? []) {
      if (!affected.has(dep)) { affected.add(dep); queue.push(dep); }
    }
    for (const consumer of reverseBridges.get(current) ?? []) {
      if (!affected.has(consumer)) { affected.add(consumer); queue.push(consumer); }
    }
  }
  return affected;
}

describe("affected — filesToPackages", () => {
  const packages: GraphPackages = new Map([
    ["apps/server", makePkg("server", "apps/server", "typescript")],
    ["apps/flutter", makePkg("flutter", "apps/flutter", "dart")],
    ["packages/api", makePkg("api", "packages/api", "typescript")],
  ]);

  test("maps changed files to their package", () => {
    const result = filesToPackages(["apps/server/src/index.ts"], packages);
    expect(result.has("apps/server")).toBe(true);
    expect(result.size).toBe(1);
  });

  test("ignores generated/ paths", () => {
    const result = filesToPackages([
      "packages/api/generated/dart/lib/api.dart",
      "packages/api/generated/typescript/api.d.ts",
    ], packages);
    expect(result.size).toBe(0);
  });

  test("ignores node_modules/ paths", () => {
    const result = filesToPackages(["apps/server/node_modules/foo/bar.js"], packages);
    expect(result.size).toBe(0);
  });

  test("ignores .dart_tool/ paths", () => {
    const result = filesToPackages(["apps/flutter/.dart_tool/version"], packages);
    expect(result.size).toBe(0);
  });

  test("maps multiple files to multiple packages", () => {
    const result = filesToPackages([
      "apps/server/src/routes/api.ts",
      "apps/flutter/lib/main.dart",
    ], packages);
    expect(result.size).toBe(2);
    expect(result.has("apps/server")).toBe(true);
    expect(result.has("apps/flutter")).toBe(true);
  });
});

describe("affected — graph walking", () => {
  const packages: GraphPackages = new Map([
    ["apps/server", makePkg("server", "apps/server", "typescript", ["packages/shared"])],
    ["apps/flutter", makePkg("flutter", "apps/flutter", "dart")],
    ["packages/shared", makePkg("shared", "packages/shared", "typescript")],
    ["packages/api", makePkg("api", "packages/api", "typescript")],
  ]);

  const bridges: Bridge[] = [
    { source: "packages/api", artifact: "openapi.json", consumers: ["apps/flutter"], run: undefined, watch: undefined, entryFile: undefined, specPath: undefined },
  ];

  test("follows dependency edges (shared → server)", () => {
    const reverseDeps = buildReverseDeps(packages);
    const reverseBridges = buildReverseBridges(bridges);
    const affected = walkForward(new Set(["packages/shared"]), reverseDeps, reverseBridges);
    expect(affected.has("packages/shared")).toBe(true);
    expect(affected.has("apps/server")).toBe(true);
  });

  test("follows bridge edges (api → flutter)", () => {
    const reverseDeps = buildReverseDeps(packages);
    const reverseBridges = buildReverseBridges(bridges);
    const affected = walkForward(new Set(["packages/api"]), reverseDeps, reverseBridges);
    expect(affected.has("packages/api")).toBe(true);
    expect(affected.has("apps/flutter")).toBe(true);
  });

  test("does not affect unrelated packages", () => {
    const reverseDeps = buildReverseDeps(packages);
    const reverseBridges = buildReverseBridges(bridges);
    const affected = walkForward(new Set(["packages/shared"]), reverseDeps, reverseBridges);
    expect(affected.has("apps/flutter")).toBe(false);
    expect(affected.has("packages/api")).toBe(false);
  });
});
