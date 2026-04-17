import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resolvePythonTool } from "@/plugins/builtin/ecosystem/python/plugin";

// The resolver decides which binary neutron invokes for a given Python
// tool. Getting this wrong means neutron silently uses a global tool
// when the user has a pinned venv copy, or vice versa — so the
// fallback order is load-bearing for reproducibility.

let root: string;
let pkgDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-pytool-"));
  pkgDir = join(root, "apps", "server");
  mkdirSync(pkgDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function placeBin(dir: string, name: string): string {
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const path = join(binDir, name);
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
}

describe("resolvePythonTool", () => {
  test("prefers <pkgDir>/.venv/bin/<tool> when present", () => {
    const expected = placeBin(join(pkgDir, ".venv"), "ruff");
    placeBin(join(root, ".venv"), "ruff"); // decoy — lower priority
    expect(resolvePythonTool("ruff", pkgDir, root)).toBe(expected);
  });

  test("falls back to <pkgDir>/venv/bin/<tool> when .venv/ missing", () => {
    const expected = placeBin(join(pkgDir, "venv"), "ruff");
    expect(resolvePythonTool("ruff", pkgDir, root)).toBe(expected);
  });

  test("falls back to <root>/.venv/bin/<tool> when package-level venvs missing", () => {
    const expected = placeBin(join(root, ".venv"), "ruff");
    expect(resolvePythonTool("ruff", pkgDir, root)).toBe(expected);
  });

  test("returns bare tool name when no venv contains the binary", () => {
    // Package has a venv but this specific tool isn't in it.
    placeBin(join(pkgDir, ".venv"), "ruff");
    expect(resolvePythonTool("pytest", pkgDir, root)).toBe("pytest");
  });

  test("does not cross-wire between tools — each name resolves independently", () => {
    // ruff in pkg venv, pytest only in workspace venv.
    const expectedRuff = placeBin(join(pkgDir, ".venv"), "ruff");
    const expectedPytest = placeBin(join(root, ".venv"), "pytest");
    expect(resolvePythonTool("ruff", pkgDir, root)).toBe(expectedRuff);
    expect(resolvePythonTool("pytest", pkgDir, root)).toBe(expectedPytest);
  });

  test("<pkgDir>/.venv wins over <pkgDir>/venv", () => {
    const expected = placeBin(join(pkgDir, ".venv"), "ruff");
    placeBin(join(pkgDir, "venv"), "ruff"); // lower priority
    expect(resolvePythonTool("ruff", pkgDir, root)).toBe(expected);
  });

  test("<pkgDir>/venv wins over <root>/.venv", () => {
    const expected = placeBin(join(pkgDir, "venv"), "ruff");
    placeBin(join(root, ".venv"), "ruff"); // lower priority
    expect(resolvePythonTool("ruff", pkgDir, root)).toBe(expected);
  });
});
