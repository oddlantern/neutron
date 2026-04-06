import { describe, expect, test } from "bun:test";

import type { WorkspacePackage } from "../../src/graph/types.js";
import { detectCycles, topologicalSort } from "../../src/graph/topo.js";

function makePkg(path: string, localDeps: readonly string[] = []): WorkspacePackage {
  return {
    name: path,
    path,
    ecosystem: "typescript",
    version: "1.0.0",
    dependencies: [],
    localDependencies: localDeps,
  };
}

function toMap(pkgs: WorkspacePackage[]): ReadonlyMap<string, WorkspacePackage> {
  return new Map(pkgs.map((p) => [p.path, p]));
}

// ─── detectCycles ────────────────────────────────────────────────────────────

describe("detectCycles", () => {
  test("returns empty array for acyclic graph", () => {
    const packages = toMap([
      makePkg("a", ["b"]),
      makePkg("b", ["c"]),
      makePkg("c"),
    ]);
    expect(detectCycles(packages)).toEqual([]);
  });

  test("detects simple A → B → A cycle", () => {
    const packages = toMap([
      makePkg("a", ["b"]),
      makePkg("b", ["a"]),
    ]);
    const cycles = detectCycles(packages);
    expect(cycles.length).toBeGreaterThan(0);
    // The cycle should contain both nodes
    const flat = cycles.flat();
    expect(flat).toContain("a");
    expect(flat).toContain("b");
  });

  test("detects three-node cycle A → B → C → A", () => {
    const packages = toMap([
      makePkg("a", ["b"]),
      makePkg("b", ["c"]),
      makePkg("c", ["a"]),
    ]);
    const cycles = detectCycles(packages);
    expect(cycles.length).toBeGreaterThan(0);
  });

  test("returns empty for diamond graph (no cycle)", () => {
    //   a
    //  / \
    // b   c
    //  \ /
    //   d
    const packages = toMap([
      makePkg("a", ["b", "c"]),
      makePkg("b", ["d"]),
      makePkg("c", ["d"]),
      makePkg("d"),
    ]);
    expect(detectCycles(packages)).toEqual([]);
  });

  test("detects self-referencing node", () => {
    const packages = toMap([
      makePkg("a", ["a"]),
    ]);
    const cycles = detectCycles(packages);
    expect(cycles.length).toBeGreaterThan(0);
  });

  test("returns empty for independent nodes", () => {
    const packages = toMap([
      makePkg("a"),
      makePkg("b"),
      makePkg("c"),
    ]);
    expect(detectCycles(packages)).toEqual([]);
  });

  test("returns empty for empty graph", () => {
    expect(detectCycles(new Map())).toEqual([]);
  });

  test("ignores dependencies outside the package set", () => {
    const packages = toMap([
      makePkg("a", ["external-pkg"]),
      makePkg("b"),
    ]);
    expect(detectCycles(packages)).toEqual([]);
  });
});

// ─── topologicalSort ─────────────────────────────────────────────────────────

describe("topologicalSort", () => {
  test("sorts linear chain: deps come first", () => {
    const packages = toMap([
      makePkg("a", ["b"]),
      makePkg("b", ["c"]),
      makePkg("c"),
    ]);
    const sorted = topologicalSort(packages);
    const idxA = sorted.indexOf("a");
    const idxB = sorted.indexOf("b");
    const idxC = sorted.indexOf("c");
    // c has no deps, so it comes first; a depends on b, b on c
    expect(idxC).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxA);
  });

  test("sorts diamond graph correctly", () => {
    const packages = toMap([
      makePkg("a", ["b", "c"]),
      makePkg("b", ["d"]),
      makePkg("c", ["d"]),
      makePkg("d"),
    ]);
    const sorted = topologicalSort(packages);
    // d must come before b and c; b and c must come before a
    expect(sorted.indexOf("d")).toBeLessThan(sorted.indexOf("b"));
    expect(sorted.indexOf("d")).toBeLessThan(sorted.indexOf("c"));
    expect(sorted.indexOf("b")).toBeLessThan(sorted.indexOf("a"));
    expect(sorted.indexOf("c")).toBeLessThan(sorted.indexOf("a"));
  });

  test("handles independent nodes", () => {
    const packages = toMap([
      makePkg("a"),
      makePkg("b"),
      makePkg("c"),
    ]);
    const sorted = topologicalSort(packages);
    expect(sorted).toHaveLength(3);
    expect(new Set(sorted)).toEqual(new Set(["a", "b", "c"]));
  });

  test("handles empty graph", () => {
    expect(topologicalSort(new Map())).toEqual([]);
  });

  test("throws on cycle", () => {
    const packages = toMap([
      makePkg("a", ["b"]),
      makePkg("b", ["a"]),
    ]);
    expect(() => topologicalSort(packages)).toThrow(/cycle/i);
  });

  test("sorts subset of packages", () => {
    const packages = toMap([
      makePkg("a", ["b"]),
      makePkg("b", ["c"]),
      makePkg("c"),
      makePkg("d", ["a"]),
    ]);
    // Sort only a, b, c — exclude d
    const subset = new Set(["a", "b", "c"]);
    const sorted = topologicalSort(packages, subset);
    expect(sorted).toHaveLength(3);
    expect(sorted.indexOf("c")).toBeLessThan(sorted.indexOf("b"));
    expect(sorted.indexOf("b")).toBeLessThan(sorted.indexOf("a"));
  });

  test("subset ignores deps outside the subset", () => {
    const packages = toMap([
      makePkg("a", ["b", "external"]),
      makePkg("b"),
    ]);
    const subset = new Set(["a", "b"]);
    const sorted = topologicalSort(packages, subset);
    expect(sorted).toEqual(["b", "a"]);
  });
});
