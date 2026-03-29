import { describe, expect, mock, test } from "bun:test";

import type { DepUsage, RegistryMetadata } from "@/outdated/types";

const mockFetchMetadata = mock();

// Mock the registry module before importing level1.
// Re-export all original exports so other test files importing the real module are unaffected.
const original = await import("@/outdated/registry.js");
mock.module("../../src/outdated/registry.js", () => ({
  ...original,
  fetchMetadata: (...args: readonly unknown[]) => mockFetchMetadata(...args),
}));

// Import after mock setup so the module picks up the mock
const { runLevel1 } = await import("@/outdated/level1.js");

function makeDep(overrides: Partial<DepUsage> = {}): DepUsage {
  return {
    name: "some-pkg",
    ecosystem: "typescript",
    range: "^1.0.0",
    packages: ["/app"],
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<RegistryMetadata> = {}): RegistryMetadata {
  return {
    latest: "2.0.0",
    deprecated: undefined,
    peerDependencies: undefined,
    repositoryUrl: undefined,
    tarballUrl: undefined,
    changelogUrl: undefined,
    ...overrides,
  };
}

describe("detectPeerConflicts (via runLevel1)", () => {
  test("no peer deps produces no conflicts", async () => {
    mockFetchMetadata.mockReset();
    mockFetchMetadata.mockResolvedValueOnce(
      makeMetadata({ peerDependencies: undefined }),
    );

    const { outdated: result } = await runLevel1(
      [makeDep()],
      new Map([["some-pkg", "^1.0.0"]]),
    );

    expect(result.length).toBe(1);
    expect(result[0]?.peerConflicts).toEqual([]);
  });

  test("peer dep not in workspace is skipped (no conflict)", async () => {
    mockFetchMetadata.mockReset();
    mockFetchMetadata.mockResolvedValueOnce(
      makeMetadata({
        peerDependencies: { "unknown-peer": "^3.0.0" },
      }),
    );

    const { outdated: result } = await runLevel1(
      [makeDep()],
      new Map([["some-pkg", "^1.0.0"]]),
    );

    expect(result.length).toBe(1);
    expect(result[0]?.peerConflicts).toEqual([]);
  });

  test("same major version produces no conflict", async () => {
    mockFetchMetadata.mockReset();
    mockFetchMetadata.mockResolvedValueOnce(
      makeMetadata({
        peerDependencies: { react: "^18.2.0" },
      }),
    );

    const { outdated: result } = await runLevel1(
      [makeDep()],
      new Map([
        ["some-pkg", "^1.0.0"],
        ["react", "^18.0.0"],
      ]),
    );

    expect(result.length).toBe(1);
    expect(result[0]?.peerConflicts).toEqual([]);
  });

  test("different major version produces a conflict", async () => {
    mockFetchMetadata.mockReset();
    mockFetchMetadata.mockResolvedValueOnce(
      makeMetadata({
        peerDependencies: { react: "^19.0.0" },
      }),
    );

    const { outdated: result } = await runLevel1(
      [makeDep()],
      new Map([
        ["some-pkg", "^1.0.0"],
        ["react", "^18.0.0"],
      ]),
    );

    expect(result.length).toBe(1);
    expect(result[0]?.peerConflicts.length).toBe(1);
    expect(result[0]?.peerConflicts[0]?.peerName).toBe("react");
    expect(result[0]?.peerConflicts[0]?.conflicting).toBe(true);
  });

  test("malformed version (NaN) does not crash", async () => {
    mockFetchMetadata.mockReset();
    mockFetchMetadata.mockResolvedValueOnce(
      makeMetadata({
        peerDependencies: { react: "latest" },
      }),
    );

    const { outdated: result } = await runLevel1(
      [makeDep()],
      new Map([
        ["some-pkg", "^1.0.0"],
        ["react", "^18.0.0"],
      ]),
    );

    // NaN !== undefined is true, NaN !== 18 is true → conflict detected
    // Main assertion: no crash
    expect(result.length).toBe(1);
  });
});

describe("runLevel1 orchestration", () => {
  test("filters out up-to-date deps", async () => {
    mockFetchMetadata.mockReset();
    // current = 2.0.0, latest = 2.0.0 → classifyUpdate returns null → skipped
    mockFetchMetadata.mockResolvedValueOnce(
      makeMetadata({ latest: "2.0.0" }),
    );

    const { outdated: result } = await runLevel1(
      [makeDep({ range: "^2.0.0" })],
      new Map(),
    );

    expect(result.length).toBe(0);
  });

  test("returns enriched OutdatedDep with metadata, peerConflicts, and risk", async () => {
    mockFetchMetadata.mockReset();
    mockFetchMetadata.mockResolvedValueOnce(
      makeMetadata({
        latest: "3.0.0",
        deprecated: "Use v4",
        tarballUrl: "https://registry.npmjs.org/pkg/-/pkg-3.0.0.tgz",
      }),
    );

    const { outdated: result } = await runLevel1(
      [makeDep({ range: "^2.0.0", packages: ["/app", "/lib"] })],
      new Map(),
    );

    expect(result.length).toBe(1);
    const dep = result[0]!;
    expect(dep.name).toBe("some-pkg");
    expect(dep.ecosystem).toBe("typescript");
    expect(dep.latest).toBe("3.0.0");
    expect(dep.severity).toBe("major");
    expect(dep.metadata.deprecated).toBe("Use v4");
    expect(dep.peerConflicts).toEqual([]);
    expect(dep.risk.total).toBeGreaterThan(0);
    expect(dep.risk.deprecation).toBeGreaterThan(0);
  });

  test("handles null metadata (fetch failure) gracefully and counts as skipped", async () => {
    mockFetchMetadata.mockReset();
    mockFetchMetadata.mockResolvedValueOnce(null);

    const { outdated: result, skipped } = await runLevel1(
      [makeDep()],
      new Map(),
    );

    expect(result.length).toBe(0);
    expect(skipped).toBe(1);
  });

  test("batches correctly with more than 10 deps", async () => {
    mockFetchMetadata.mockReset();
    const deps: DepUsage[] = [];
    for (let i = 0; i < 15; i++) {
      deps.push(makeDep({ name: `pkg-${i}`, range: "^1.0.0" }));
    }

    // All return a newer version
    for (let i = 0; i < 15; i++) {
      mockFetchMetadata.mockResolvedValueOnce(makeMetadata({ latest: "2.0.0" }));
    }

    const { outdated: result } = await runLevel1(deps, new Map());

    // All 15 should be processed (10 in first batch, 5 in second)
    expect(result.length).toBe(15);
    expect(mockFetchMetadata).toHaveBeenCalledTimes(15);
  });

  test("mixed results: some outdated, some up-to-date, some failed", async () => {
    mockFetchMetadata.mockReset();
    const deps: DepUsage[] = [
      makeDep({ name: "outdated-pkg", range: "^1.0.0" }),
      makeDep({ name: "current-pkg", range: "^2.0.0" }),
      makeDep({ name: "failed-pkg", range: "^1.0.0" }),
    ];

    // outdated-pkg: newer version available
    mockFetchMetadata.mockResolvedValueOnce(makeMetadata({ latest: "2.0.0" }));
    // current-pkg: up to date
    mockFetchMetadata.mockResolvedValueOnce(makeMetadata({ latest: "2.0.0" }));
    // failed-pkg: fetch failure
    mockFetchMetadata.mockResolvedValueOnce(null);

    const { outdated: result, skipped } = await runLevel1(deps, new Map());

    expect(result.length).toBe(1);
    expect(result[0]?.name).toBe("outdated-pkg");
    expect(skipped).toBe(1);
  });
});
