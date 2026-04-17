import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { WorkspacePackage } from "@/graph/types";
import { executeOpenapiClientGeneration } from "@/plugins/builtin/ecosystem/python/openapi-codegen";
import type { ExecutionContext } from "@/plugins/types";

// These tests cover the error surfaces and the contract of
// executeOpenapiClientGeneration. The happy path needs
// openapi-python-client on PATH/venv which we don't assume in local
// test runs — integration exercise lives at the CI layer where the
// tool will be pre-installed.

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-py-oapi-codegen-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makePkg(): WorkspacePackage {
  return {
    name: "py-client",
    path: "packages/py-client",
    ecosystem: "python",
    version: "1.0.0",
    dependencies: [],
    localDependencies: [],
  };
}

function makeContext(overrides: Partial<ExecutionContext>): ExecutionContext {
  return {
    graph: {
      name: "test",
      root,
      packages: new Map(),
      bridges: [],
    },
    packageManager: "bun",
    root,
    findEcosystemHandlers: async () => [],
    ...overrides,
  };
}

describe("executeOpenapiClientGeneration — error surfaces", () => {
  test("fails when artifactPath is not set", async () => {
    const result = await executeOpenapiClientGeneration(
      makePkg(),
      root,
      makeContext({ outputDir: join(root, "out") }),
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("artifactPath");
  });

  test("fails when outputDir is not set", async () => {
    const result = await executeOpenapiClientGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath: "openapi.json" }),
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("outputDir");
  });

  test("fails when spec file doesn't exist at the resolved path", async () => {
    // outputDir exists; artifactPath points to a file that doesn't.
    const outDir = join(root, "out");
    mkdirSync(outDir, { recursive: true });
    const result = await executeOpenapiClientGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath: "nowhere.json", outputDir: outDir }),
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Spec file not found");
    expect(result.summary).toContain("nowhere.json");
  });

  test("surfaces install hint when openapi-python-client is missing", async () => {
    // The resolver falls back to the bare tool name when no venv
    // contains the binary. runCommand then fails because the command
    // isn't on PATH either. We don't install openapi-python-client
    // during local test runs, so this is the realistic failure mode.
    const outDir = join(root, "out");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(root, "openapi.json"), '{"openapi":"3.0.0"}', "utf-8");

    const result = await executeOpenapiClientGeneration(
      makePkg(),
      root,
      makeContext({ artifactPath: "openapi.json", outputDir: outDir }),
    );
    // We can't assert success either way (env-dependent), but if it
    // failed, the hint must point at the install path. If it succeeded
    // (CI with the tool installed), skip the hint check.
    if (!result.success) {
      expect(result.summary).toContain("openapi-python-client");
      expect(result.summary).toMatch(/pip install|uv tool install/);
    }
  });
});
