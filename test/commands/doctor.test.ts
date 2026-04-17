import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// `neutron doctor` is the user's health dashboard for a workspace —
// config parse, git hooks, generated output presence, tool detection,
// experimental-plugin warnings. These tests spawn the real CLI against
// controlled workspace fixtures so the output contract doesn't drift.

const BIN = resolve(import.meta.dir, "..", "..", "dist", "bin.js");

function run(
  args: readonly string[],
  cwd: string,
): { readonly status: number; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync("node", [BIN, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 30_000,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Combined stdout+stderr stripped of ANSI codes for substring assertions. */
function cleanOutput(r: { readonly stdout: string; readonly stderr: string }): string {
  return (r.stdout + r.stderr).replace(/\u001b\[[0-9;]*m/g, "");
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "neutron-doctor-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(config: string): void {
  writeFileSync(join(tmp, "neutron.yml"), config, "utf-8");
}

/** Scaffold a minimal TS package so the ecosystem's `packages` list isn't empty. */
function writeTsPackage(relPath: string, name: string): void {
  const pkgDir = join(tmp, relPath);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name, version: "0.0.0" }),
    "utf-8",
  );
}

/** Scaffold a minimal Python package. */
function writePyPackage(relPath: string, name: string): void {
  const pkgDir = join(tmp, relPath);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "pyproject.toml"),
    `[project]\nname = "${name}"\nversion = "0.0.0"\n`,
    "utf-8",
  );
}

/** Scaffold a minimal Dart package. */
function writeDartPackage(relPath: string, name: string): void {
  const pkgDir = join(tmp, relPath);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "pubspec.yaml"),
    `name: ${name}\nversion: 0.0.0\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n`,
    "utf-8",
  );
}

function initGit(): void {
  // Create an empty .git dir so doctor's git-hooks check has something
  // to inspect. A full init would work but adds dependencies on git
  // being installed on CI; a bare directory is enough because the
  // hook-presence check only looks at file existence.
  mkdirSync(join(tmp, ".git", "hooks"), { recursive: true });
}

describe("neutron doctor — baseline", () => {
  test("passes on a minimal workspace with a valid config", () => {
    writeConfig(
      [
        "workspace: test",
        "ecosystems:",
        "  typescript:",
        "    manifest: package.json",
        "    packages:",
        "      - packages/a",
      ].join("\n"),
    );
    writeTsPackage("packages/a", "a");
    initGit();

    const r = run(["doctor"], tmp);
    const out = cleanOutput(r);
    // All good: exit 0, and the header shows up.
    expect(r.status).toBe(0);
    expect(out).toContain("neutron doctor");
    // Config row passes (0 packages is fine).
    expect(out).toMatch(/neutron\.yml/);
  });

  test("fails with exit 1 when no config is present", () => {
    // No neutron.yml at all.
    const r = run(["doctor"], tmp);
    expect(r.status).toBe(1);
    const out = cleanOutput(r);
    // Doctor surfaces the parse failure — the word "neutron.yml" and
    // a fail indicator should be visible.
    expect(out).toContain("neutron.yml");
  });
});

describe("neutron doctor — git hooks reporting", () => {
  test("warns when no hooks are installed", () => {
    writeConfig(
      [
        "workspace: test",
        "ecosystems:",
        "  typescript:",
        "    manifest: package.json",
        "    packages:",
        "      - packages/a",
      ].join("\n"),
    );
    writeTsPackage("packages/a", "a");
    initGit();

    const r = run(["doctor"], tmp);
    const out = cleanOutput(r);
    // Warnings don't fail the command — exit 0 but the row should say
    // something about running `neutron install`.
    expect(r.status).toBe(0);
    expect(out).toContain("git hooks");
    expect(out).toContain("neutron install");
  });

  test("reports 4/4 when all hooks are installed", () => {
    writeConfig(
      [
        "workspace: test",
        "ecosystems:",
        "  typescript:",
        "    manifest: package.json",
        "    packages:",
        "      - packages/a",
      ].join("\n"),
    );
    writeTsPackage("packages/a", "a");
    initGit();
    for (const hook of ["pre-commit", "commit-msg", "post-merge", "post-checkout"]) {
      writeFileSync(join(tmp, ".git", "hooks", hook), "#!/bin/sh\nexit 0\n", "utf-8");
    }

    const r = run(["doctor"], tmp);
    expect(r.status).toBe(0);
    const out = cleanOutput(r);
    expect(out).toMatch(/git hooks.*4\/4/);
  });
});

describe("neutron doctor — experimental plugin warnings", () => {
  test("surfaces experimental plugin warning for python ecosystems in config", () => {
    writeConfig(
      [
        "workspace: test",
        "ecosystems:",
        "  python:",
        "    manifest: pyproject.toml",
        "    packages:",
        "      - packages/py",
      ].join("\n"),
    );
    writePyPackage("packages/py", "py");
    initGit();

    const r = run(["doctor"], tmp);
    const out = cleanOutput(r);
    expect(r.status).toBe(0);
    expect(out).toContain("experimental plugins");
    expect(out).toContain("python");
    expect(out).toContain("feature parity");
  });

  test("doesn't surface the experimental warning for stable-only workspaces", () => {
    writeConfig(
      [
        "workspace: test",
        "ecosystems:",
        "  typescript:",
        "    manifest: package.json",
        "    packages:",
        "      - packages/ts",
        "  dart:",
        "    manifest: pubspec.yaml",
        "    packages:",
        "      - packages/dart",
      ].join("\n"),
    );
    writeTsPackage("packages/ts", "ts");
    writeDartPackage("packages/dart", "dart_pkg");
    initGit();

    const r = run(["doctor"], tmp);
    const out = cleanOutput(r);
    // TS + Dart are both stable — no warning row should appear.
    expect(out).not.toContain("experimental plugins");
  });
});
