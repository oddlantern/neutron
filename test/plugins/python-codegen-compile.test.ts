import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { WorkspacePackage } from "@/graph/types";
import type { ValidatedTokens } from "@/plugins/builtin/domain/design/types";
import { executeTokenGeneration } from "@/plugins/builtin/ecosystem/python/token-codegen";
import type { ExecutionContext } from "@/plugins/types";

// End-to-end assertion that the Python code our generator emits
// actually parses. Substring-level tests in python-token-codegen.test.ts
// catch missing section headers and naming regressions, but a missing
// colon or unclosed bracket would still pass them — py_compile catches
// syntax-level breakage the structural tests can't.

/** Returns true if `python` (or `python3`) is on PATH. */
function findPython(): string | null {
  for (const candidate of ["python3", "python"]) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf-8" });
    if (result.status === 0) {
      return candidate;
    }
  }
  return null;
}

function makeTokens(): ValidatedTokens {
  return {
    standard: {
      brand: {},
      color: {
        primary: { light: "#0066ff", dark: "#4488ff" },
        accentColor: { light: "#ff6600", dark: "#ffaa44" },
      },
      spacing: { xs: 4, md: 16 },
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
    name: "py-codegen-compile",
    path: "packages/compile-check",
    ecosystem: "python",
    version: "1.0.0",
    dependencies: [],
    localDependencies: [],
  };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-py-compile-"));
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

const python = findPython();

describe("python codegen compile-check — tokens", () => {
  test.skipIf(!python)("generated tokens.py parses under py_compile", () => {
    const outDir = join(root, "out");
    const result = executeTokenGeneration(makePkg(), root, makeContext(outDir));
    expect(result.success).toBe(true);

    // py_compile returns 0 on valid syntax, non-zero on SyntaxError.
    // No deps needed — we only care that the grammar parses.
    const check = spawnSync(python!, ["-m", "py_compile", join(outDir, "tokens.py")], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    if (check.status !== 0) {
      throw new Error(
        `py_compile failed (exit ${String(check.status)}):\n${check.stderr ?? ""}`,
      );
    }
    expect(check.status).toBe(0);
  }, 15_000);
});
