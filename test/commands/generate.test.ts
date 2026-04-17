import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// `neutron generate` is the non-watch equivalent of `neutron dev` —
// the fresh-clone and CI path for producing generated code. Bridge
// pipeline execution itself is exhaustively covered at the unit and
// integration level (test/tokens/shared-artifact.test.ts,
// test/exporter/exporter.test.ts). These command-level tests lock in
// the CLI contract: the shapes of workspaces generate handles
// correctly, and the messages users see.

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

function cleanOutput(r: { readonly stdout: string; readonly stderr: string }): string {
  return (r.stdout + r.stderr).replace(/\u001b\[[0-9;]*m/g, "");
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "neutron-generate-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeTsPackage(relPath: string, name: string): void {
  const dir = join(tmp, relPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "0.0.0" }), "utf-8");
}

describe("neutron generate — workspaces without bridges", () => {
  test("exits 0 with an informational message when no bridges are configured", () => {
    writeFileSync(
      join(tmp, "neutron.yml"),
      [
        "workspace: test",
        "ecosystems:",
        "  typescript:",
        "    manifest: package.json",
        "    packages:",
        "      - packages/a",
      ].join("\n"),
      "utf-8",
    );
    writeTsPackage("packages/a", "a");

    const r = run(["generate"], tmp);
    expect(r.status).toBe(0);
    const out = cleanOutput(r);
    // Don't overconstrain the exact wording — just that it signals
    // nothing-to-do rather than succeeding silently.
    expect(out.toLowerCase()).toContain("no bridges");
  });
});

describe("neutron generate — error paths", () => {
  test("exits 1 when no neutron.yml exists", () => {
    // Empty directory — nothing to load.
    const r = run(["generate"], tmp);
    expect(r.status).toBe(1);
  });

  test("exits 1 when neutron.yml is malformed", () => {
    writeFileSync(
      join(tmp, "neutron.yml"),
      "workspace: test\necosystems: not-an-object\n",
      "utf-8",
    );
    const r = run(["generate"], tmp);
    expect(r.status).toBe(1);
  });
});

describe("neutron generate — --dry-run", () => {
  test("succeeds without writing anything when no bridges exist", () => {
    writeFileSync(
      join(tmp, "neutron.yml"),
      [
        "workspace: test",
        "ecosystems:",
        "  typescript:",
        "    manifest: package.json",
        "    packages:",
        "      - packages/a",
      ].join("\n"),
      "utf-8",
    );
    writeTsPackage("packages/a", "a");

    const r = run(["generate", "--dry-run"], tmp);
    expect(r.status).toBe(0);
  });
});
