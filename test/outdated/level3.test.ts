import { describe, expect, test } from "bun:test";

import { isSafeDepName, validateGenericDeps } from "@/outdated/level3";
import type { OutdatedDep } from "@/outdated/types";

// isSafeDepName gates what gets interpolated into import/require
// statements in temp validation source files. A name that breaks out of
// the string literal can execute arbitrary code under typecheck, so
// these tests guard the injection surface explicitly.
describe("isSafeDepName (typescript)", () => {
  test("accepts a plain package name", () => {
    expect(isSafeDepName("react", "typescript")).toBe(true);
  });

  test("accepts a scoped package", () => {
    expect(isSafeDepName("@types/node", "typescript")).toBe(true);
  });

  test("accepts hyphenated names", () => {
    expect(isSafeDepName("my-lib", "typescript")).toBe(true);
  });

  test("accepts names with dots", () => {
    expect(isSafeDepName("lodash.debounce", "typescript")).toBe(true);
  });

  test("accepts underscore in middle but not as first char (npm rule)", () => {
    expect(isSafeDepName("my_lib", "typescript")).toBe(true);
    expect(isSafeDepName("_internal", "typescript")).toBe(false);
  });

  test("accepts tilde as first or middle char", () => {
    expect(isSafeDepName("~tilde", "typescript")).toBe(true);
    expect(isSafeDepName("a~b", "typescript")).toBe(true);
  });

  test("rejects name containing quotes (string escape)", () => {
    expect(isSafeDepName('evil"name', "typescript")).toBe(false);
  });

  test("rejects name containing semicolons (statement break)", () => {
    expect(isSafeDepName("a;require('fs')", "typescript")).toBe(false);
  });

  test("rejects name with newline", () => {
    expect(isSafeDepName("a\nb", "typescript")).toBe(false);
  });

  test("rejects name with spaces", () => {
    expect(isSafeDepName("hello world", "typescript")).toBe(false);
  });

  test("rejects name with uppercase (npm normalizes to lowercase)", () => {
    expect(isSafeDepName("MyPackage", "typescript")).toBe(false);
  });

  test("rejects name starting with a dot", () => {
    expect(isSafeDepName(".dotprefix", "typescript")).toBe(false);
  });

  test("rejects empty name", () => {
    expect(isSafeDepName("", "typescript")).toBe(false);
  });

  test("rejects scope without package part", () => {
    expect(isSafeDepName("@scope/", "typescript")).toBe(false);
  });
});

describe("isSafeDepName (dart)", () => {
  test("accepts snake_case", () => {
    expect(isSafeDepName("my_package", "dart")).toBe(true);
  });

  test("accepts name starting with underscore", () => {
    expect(isSafeDepName("_private", "dart")).toBe(true);
  });

  test("accepts digits after the first char", () => {
    expect(isSafeDepName("pkg2", "dart")).toBe(true);
  });

  test("rejects camelCase (not valid Dart package names)", () => {
    expect(isSafeDepName("myPackage", "dart")).toBe(false);
  });

  test("rejects hyphenated names (invalid in Dart)", () => {
    expect(isSafeDepName("my-package", "dart")).toBe(false);
  });

  test("rejects names starting with a digit", () => {
    expect(isSafeDepName("1pkg", "dart")).toBe(false);
  });

  test("rejects names with dots", () => {
    expect(isSafeDepName("lodash.debounce", "dart")).toBe(false);
  });

  test("rejects names with quotes or semicolons", () => {
    expect(isSafeDepName("a';b", "dart")).toBe(false);
    expect(isSafeDepName('a"b', "dart")).toBe(false);
  });
});

// validateGenericDeps is the L3 placeholder for ecosystems that don't
// yet have temp-dir validation. It should return one result per input
// dep, all marked "passed", with an explanatory output string — and
// never fail the pipeline.
describe("validateGenericDeps", () => {
  const mkDep = (overrides: Partial<OutdatedDep>): OutdatedDep => ({
    name: overrides.name ?? "somepkg",
    ecosystem: overrides.ecosystem ?? "python",
    latest: overrides.latest ?? "2.0.0",
    workspaceRange: "^1.0.0",
    packages: ["packages/a"],
    severity: "minor",
    metadata: {
      latest: overrides.latest ?? "2.0.0",
      deprecated: undefined,
      peerDependencies: undefined,
      repositoryUrl: undefined,
      tarballUrl: undefined,
      changelogUrl: undefined,
    },
    peerConflicts: [],
    risk: {
      total: 0,
      severity: 0,
      affectedCount: 0,
      deprecation: 0,
      peerConflicts: 0,
    },
    ...overrides,
  });

  test("returns one result per input dep", async () => {
    const deps = [mkDep({ name: "a" }), mkDep({ name: "b" }), mkDep({ name: "c" })];
    const results = await validateGenericDeps(deps, "python");
    expect(results).toHaveLength(3);
  });

  test("marks all deps as passed (placeholder)", async () => {
    const deps = [mkDep({ name: "a" }), mkDep({ name: "b" })];
    const results = await validateGenericDeps(deps, "rust");
    for (const r of results) {
      expect(r.typecheckPassed).toBe(true);
      expect(r.testsPassed).toBe(true);
    }
  });

  test("includes ecosystem name and version in typecheckOutput", async () => {
    const [result] = await validateGenericDeps([mkDep({ name: "pkg", latest: "3.1.4" })], "go");
    expect(result.typecheckOutput).toContain("go");
    expect(result.typecheckOutput).toContain("3.1.4");
  });

  test("returns empty result set for empty input", async () => {
    const results = await validateGenericDeps([], "php");
    expect(results).toHaveLength(0);
  });

  test("preserves dep reference in each result", async () => {
    const dep = mkDep({ name: "reference-me" });
    const [result] = await validateGenericDeps([dep], "rust");
    expect(result.dep).toBe(dep);
  });
});
