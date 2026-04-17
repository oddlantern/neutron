import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { WorkspacePackage } from "@/graph/types";
import type { ValidatedTokens } from "@/plugins/builtin/domain/design/types";
import { executeTokenGeneration } from "@/plugins/builtin/ecosystem/go/token-codegen";
import type { ExecutionContext } from "@/plugins/types";

// End-to-end: does the generated Go actually compile?
// `go build ./...` parses, type-checks, and links every package under
// the module. A single missing comma or unexported field reference
// would fail — the structural unit tests can't see those.

function hasGo(): boolean {
  const r = spawnSync("go", ["version"], { encoding: "utf-8" });
  return r.status === 0;
}

function makeTokens(): ValidatedTokens {
  return {
    standard: {
      brand: {},
      color: {
        primary: { light: "#0066ff", dark: "#4488ff" },
        accentColor: { light: "#ff6600", dark: "#ffaa44" },
      },
      spacing: { xs: 4, mdLarge: 24 },
      radius: { sm: 4, full: 9999 },
      elevation: {},
      shadowCard: undefined,
      iconSize: { md: 24 },
      typography: undefined,
    },
    extensions: {
      genres: {
        meta: { className: "GenreColors", getter: "genres" },
        fields: {
          fantasy: { light: "#aabbcc", dark: "#112233" },
        },
      },
    },
  };
}

function makePkg(): WorkspacePackage {
  return {
    name: "go-codegen-compile",
    path: "packages/compile-check",
    ecosystem: "go",
    version: "1.0.0",
    dependencies: [],
    localDependencies: [],
  };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-go-compile-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeContext(outputDir: string): ExecutionContext {
  return {
    graph: { name: "ws", root, packages: new Map(), bridges: [] },
    packageManager: "bun",
    root,
    findEcosystemHandlers: async () => [],
    outputDir,
    sourceName: "compile-check",
    domainData: makeTokens(),
  };
}

const goAvailable = hasGo();

describe("go codegen compile-check — tokens", () => {
  test.skipIf(!goAvailable)("generated tokens crate compiles under `go build`", () => {
    const outDir = join(root, "out");
    const result = executeTokenGeneration(makePkg(), root, makeContext(outDir));
    expect(result.success).toBe(true);

    // `go build ./...` compiles every package under the module root.
    // No deps in the tokens crate, so this works offline.
    const build = spawnSync("go", ["build", "./..."], {
      cwd: outDir,
      encoding: "utf-8",
      timeout: 60_000,
      env: { ...process.env, GOFLAGS: "-mod=mod" },
    });
    if (build.status !== 0) {
      throw new Error(
        `go build failed (exit ${String(build.status)}):\n${build.stdout ?? ""}\n${build.stderr ?? ""}`,
      );
    }
    expect(build.status).toBe(0);
  }, 90_000);

  test.skipIf(!goAvailable)("generated tokens file passes `go vet`", () => {
    // go vet catches idiom issues (unused imports, shadowing, etc.)
    // that a bare build wouldn't surface.
    const outDir = join(root, "out");
    executeTokenGeneration(makePkg(), root, makeContext(outDir));
    const vet = spawnSync("go", ["vet", "./..."], {
      cwd: outDir,
      encoding: "utf-8",
      timeout: 60_000,
      env: { ...process.env, GOFLAGS: "-mod=mod" },
    });
    if (vet.status !== 0) {
      throw new Error(
        `go vet failed (exit ${String(vet.status)}):\n${vet.stdout ?? ""}\n${vet.stderr ?? ""}`,
      );
    }
    expect(vet.status).toBe(0);
  }, 60_000);
});
