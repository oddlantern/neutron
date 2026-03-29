import { describe, expect, test } from "bun:test";

import {
  filesToPackages,
  buildReverseDeps,
  buildReverseBridges,
  walkForward,
} from "@/commands/affected";
import type { WorkspacePackage, Bridge } from "@/graph/types";

type GraphPackages = ReadonlyMap<string, WorkspacePackage>;

function makePkg(name: string, path: string, eco: string, localDeps: string[] = []): WorkspacePackage {
  return { name, path, ecosystem: eco, version: "0.0.0", dependencies: [], localDependencies: localDeps };
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

  const bridges: readonly Bridge[] = [
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
