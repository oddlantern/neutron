import { describe, test, expect } from "bun:test";

import { runCommand } from "@/plugins/builtin/shared/exec";

describe("runCommand", () => {
  test("successful command", async () => {
    const result = await runCommand("echo", ["hello"], process.cwd());

    expect(result.success).toBe(true);
    expect(result.output).toContain("hello");
    expect(result.duration).toBeGreaterThan(0);
    expect(result.summary).toContain("completed");
  });

  test("failed command", async () => {
    const result = await runCommand("node", ["-e", "process.exit(1)"], process.cwd());

    expect(result.success).toBe(false);
    expect(result.summary).toContain("failed (exit 1)");
  });

  test("captures stderr", async () => {
    const result = await runCommand("node", ["-e", "console.error('oops')"], process.cwd());

    expect(result.output).toContain("oops");
  });

  test("captures both stdout and stderr", async () => {
    const result = await runCommand(
      "node",
      ["-e", "console.log('out'); console.error('err')"],
      process.cwd(),
    );

    expect(result.output).toContain("out");
    expect(result.output).toContain("err");
  });

  test("nonexistent command", async () => {
    const result = await runCommand(
      "__mido_nonexistent_cmd_12345",
      [],
      process.cwd(),
    );

    expect(result.success).toBe(false);
    expect(result.summary).toContain("Failed to spawn");
  });
});
