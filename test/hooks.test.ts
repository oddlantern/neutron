import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { HOOK_MARKER } from "@/branding";
import type { NeutronConfig } from "@/config/schema";
import { writeHooks } from "@/hooks";

// writeHooks is the shared entrypoint used by both `neutron install`
// (interactive = true) and the watcher's auto-install path
// (interactive = false). These tests exercise the non-interactive path
// because it's the one that runs unattended — a bug here silently
// corrupts other tools' hooks on every dev-watch launch.

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-hooks-test-"));
  mkdirSync(join(root, ".git", "hooks"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("writeHooks with default config (non-interactive)", () => {
  test("installs all four default hooks in an empty .git/hooks/", async () => {
    const result = await writeHooks(root, undefined, false);
    expect(result.installed).toBe(4);
    expect(result.disabled).toBe(0);

    for (const name of ["pre-commit", "commit-msg", "post-merge", "post-checkout"]) {
      expect(existsSync(join(root, ".git", "hooks", name))).toBe(true);
    }
  });

  test("every installed hook carries the HOOK_MARKER", async () => {
    // The marker is how neutron distinguishes its own hooks from
    // hand-rolled or other-tool-owned hooks on the next install. If the
    // marker is missing, subsequent installs would refuse to overwrite.
    await writeHooks(root, undefined, false);
    const preCommit = readFileSync(join(root, ".git", "hooks", "pre-commit"), "utf-8");
    expect(preCommit).toContain(HOOK_MARKER);
  });

  test("installed hooks are executable (0755)", async () => {
    const { statSync } = await import("node:fs");
    await writeHooks(root, undefined, false);
    const mode = statSync(join(root, ".git", "hooks", "pre-commit")).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  test("post-checkout wraps body in a branch-only conditional", async () => {
    // The post-checkout hook fires for both file checkouts (git checkout
    // <path>) and branch checkouts. Running `neutron check` on every
    // file checkout would be intolerable — so the generated script
    // guards on $3 (the "flag" arg that git sets to 1 for branch).
    await writeHooks(root, undefined, false);
    const postCheckout = readFileSync(join(root, ".git", "hooks", "post-checkout"), "utf-8");
    expect(postCheckout).toContain('"$3" = "1"');
  });

  test("creates .git/hooks/ if it doesn't already exist", async () => {
    rmSync(join(root, ".git", "hooks"), { recursive: true });
    const result = await writeHooks(root, undefined, false);
    expect(result.installed).toBe(4);
    expect(existsSync(join(root, ".git", "hooks"))).toBe(true);
  });
});

describe("writeHooks conflict handling (non-interactive)", () => {
  test("skips an existing non-neutron hook (silent, no overwrite)", async () => {
    const existingScript = "#!/bin/sh\necho 'user-owned hook, please preserve'\n";
    writeFileSync(join(root, ".git", "hooks", "pre-commit"), existingScript);

    const result = await writeHooks(root, undefined, false);
    // Three others are installed, pre-commit is preserved.
    expect(result.installed).toBe(3);

    const preserved = readFileSync(join(root, ".git", "hooks", "pre-commit"), "utf-8");
    expect(preserved).toBe(existingScript);
  });

  test("overwrites a hook that carries the neutron marker", async () => {
    const oldNeutronScript = `#!/usr/bin/env sh\n# ${HOOK_MARKER} — old version\necho old\n`;
    writeFileSync(join(root, ".git", "hooks", "pre-commit"), oldNeutronScript);

    const result = await writeHooks(root, undefined, false);
    expect(result.installed).toBe(4);

    const updated = readFileSync(join(root, ".git", "hooks", "pre-commit"), "utf-8");
    expect(updated).not.toContain("echo old");
    expect(updated).toContain(HOOK_MARKER);
  });
});

describe("writeHooks with explicit config", () => {
  test("false disables a hook — removes neutron-owned files", async () => {
    // First install with defaults, then run again with the hook disabled
    // — neutron should remove its own file rather than leaving a stale
    // pre-commit around.
    await writeHooks(root, undefined, false);
    expect(existsSync(join(root, ".git", "hooks", "commit-msg"))).toBe(true);

    const config: NeutronConfig = {
      workspace: "test",
      hooks: { "commit-msg": false },
    } as NeutronConfig;

    const result = await writeHooks(root, config, false);
    expect(result.disabled).toBe(1);
    expect(existsSync(join(root, ".git", "hooks", "commit-msg"))).toBe(false);
  });

  test("false does NOT remove a non-neutron hook", async () => {
    const foreignScript = "#!/bin/sh\necho foreign\n";
    writeFileSync(join(root, ".git", "hooks", "commit-msg"), foreignScript);

    const config: NeutronConfig = {
      workspace: "test",
      hooks: { "commit-msg": false },
    } as NeutronConfig;

    const result = await writeHooks(root, config, false);
    // No neutron-owned file existed for commit-msg, so nothing to disable.
    expect(result.disabled).toBe(0);
    expect(existsSync(join(root, ".git", "hooks", "commit-msg"))).toBe(true);
  });

  test("custom steps array replaces the default command list", async () => {
    const config: NeutronConfig = {
      workspace: "test",
      hooks: { "pre-commit": ["echo custom-step-1", "echo custom-step-2"] },
    } as NeutronConfig;

    await writeHooks(root, config, false);
    const script = readFileSync(join(root, ".git", "hooks", "pre-commit"), "utf-8");
    expect(script).toContain("echo custom-step-1");
    expect(script).toContain("echo custom-step-2");
    expect(script).not.toContain("neutron pre-commit");
  });
});
