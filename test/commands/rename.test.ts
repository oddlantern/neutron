import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const BIN = resolve(import.meta.dir, "..", "..", "dist", "bin.js");

function run(args: readonly string[], cwd: string): { status: number; stdout: string; stderr: string } {
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

describe("neutron rename", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "neutron-rename-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupWorkspace(name: string): void {
    // neutron.yml
    writeFileSync(
      join(tmpDir, "neutron.yml"),
      [
        `workspace: ${name}`,
        "ecosystems:",
        "  typescript:",
        "    manifest: package.json",
        "    packages:",
        "      - apps/server",
        "      - packages/api",
        "  dart:",
        "    manifest: pubspec.yaml",
        "    packages:",
        "      - apps/flutter",
      ].join("\n"),
      "utf-8",
    );

    // Root package.json
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ name, private: true, workspaces: ["apps/*", "packages/*"] }, null, 2),
      "utf-8",
    );

    // TS package: apps/server
    mkdirSync(join(tmpDir, "apps", "server"), { recursive: true });
    writeFileSync(
      join(tmpDir, "apps", "server", "package.json"),
      JSON.stringify({ name: `@${name}/server`, version: "0.0.0" }, null, 2),
      "utf-8",
    );

    // TS package: packages/api
    mkdirSync(join(tmpDir, "packages", "api"), { recursive: true });
    writeFileSync(
      join(tmpDir, "packages", "api", "package.json"),
      JSON.stringify({ name: `@${name}/api`, version: "0.0.0" }, null, 2),
      "utf-8",
    );

    // Dart package: apps/flutter
    mkdirSync(join(tmpDir, "apps", "flutter"), { recursive: true });
    writeFileSync(
      join(tmpDir, "apps", "flutter", "pubspec.yaml"),
      [
        `name: ${name.replace(/-/g, "_")}_flutter`,
        "version: 0.0.0",
        "",
        "dependencies:",
        `  ${name.replace(/-/g, "_")}_api:`,
        "    path: ../../packages/api/generated/dart",
        `  ${name.replace(/-/g, "_")}_design_system:`,
        "    path: ../../packages/design-system/generated/dart",
      ].join("\n"),
      "utf-8",
    );
  }

  test("exits 1 with no neutron.yml", () => {
    const { status, stderr } = run(["rename", "newname"], tmpDir);
    expect(status).toBe(1);
    expect(stderr).toContain("No neutron.yml found");
  });

  test("exits 1 with no name argument", () => {
    const { status, stderr } = run(["rename"], tmpDir);
    expect(status).toBe(1);
    expect(stderr).toContain("Usage:");
  });

  test("exits 0 when name is unchanged", () => {
    setupWorkspace("myproject");
    const { status, stdout } = run(["rename", "myproject"], tmpDir);
    expect(status).toBe(0);
    expect(stdout).toContain("already named");
  });

  test("updates neutron.yml workspace name", () => {
    setupWorkspace("oldname");
    const { status } = run(["rename", "newname"], tmpDir);
    expect(status).toBe(0);

    const content = readFileSync(join(tmpDir, "neutron.yml"), "utf-8");
    expect(content).toContain("workspace: newname");
    expect(content).not.toContain("workspace: oldname");
  });

  test("updates scoped package.json names", () => {
    setupWorkspace("oldname");
    const { status } = run(["rename", "newname"], tmpDir);
    expect(status).toBe(0);

    const serverPkg = JSON.parse(readFileSync(join(tmpDir, "apps", "server", "package.json"), "utf-8"));
    expect(serverPkg.name).toBe("@newname/server");

    const apiPkg = JSON.parse(readFileSync(join(tmpDir, "packages", "api", "package.json"), "utf-8"));
    expect(apiPkg.name).toBe("@newname/api");
  });

  test("updates root package.json name", () => {
    setupWorkspace("oldname");
    const { status } = run(["rename", "newname"], tmpDir);
    expect(status).toBe(0);

    const rootPkg = JSON.parse(readFileSync(join(tmpDir, "package.json"), "utf-8"));
    expect(rootPkg.name).toBe("newname");
  });

  test("updates pubspec.yaml name and dependencies", () => {
    setupWorkspace("oldname");
    const { status } = run(["rename", "newname"], tmpDir);
    expect(status).toBe(0);

    const pubspec = readFileSync(join(tmpDir, "apps", "flutter", "pubspec.yaml"), "utf-8");
    expect(pubspec).toContain("name: newname_flutter");
    expect(pubspec).not.toContain("oldname");
    expect(pubspec).toContain("newname_api:");
    expect(pubspec).toContain("newname_design_system:");
  });

  test("handles workspace names with regex metacharacters", () => {
    setupWorkspace("my.project");
    const { status } = run(["rename", "newproject"], tmpDir);
    expect(status).toBe(0);

    const content = readFileSync(join(tmpDir, "neutron.yml"), "utf-8");
    expect(content).toContain("workspace: newproject");
  });

  test("preserves other neutron.yml content", () => {
    setupWorkspace("oldname");
    const { status } = run(["rename", "newname"], tmpDir);
    expect(status).toBe(0);

    const content = readFileSync(join(tmpDir, "neutron.yml"), "utf-8");
    expect(content).toContain("ecosystems:");
    expect(content).toContain("apps/server");
    expect(content).toContain("apps/flutter");
  });

  test("detects platform identifiers without renaming them", () => {
    setupWorkspace("oldname");

    // Create a fake iOS project file
    const iosDir = join(tmpDir, "apps", "flutter", "ios", "Runner.xcodeproj");
    mkdirSync(iosDir, { recursive: true });
    writeFileSync(
      join(iosDir, "project.pbxproj"),
      'PRODUCT_BUNDLE_IDENTIFIER = com.oldname.app;',
      "utf-8",
    );

    const { status, stdout } = run(["rename", "newname"], tmpDir);
    expect(status).toBe(0);
    expect(stdout).toContain("Platform identifiers detected");
    expect(stdout).toContain("com.oldname.app");

    // Should NOT have renamed the platform ID
    const pbxproj = readFileSync(join(iosDir, "project.pbxproj"), "utf-8");
    expect(pbxproj).toContain("com.oldname.app");
  });

  test("renames platform identifiers with --include-platform-ids", () => {
    setupWorkspace("oldname");

    const iosDir = join(tmpDir, "apps", "flutter", "ios", "Runner.xcodeproj");
    mkdirSync(iosDir, { recursive: true });
    writeFileSync(
      join(iosDir, "project.pbxproj"),
      'PRODUCT_BUNDLE_IDENTIFIER = com.oldname.app;',
      "utf-8",
    );

    const { status, stdout } = run(["rename", "newname", "--include-platform-ids"], tmpDir);
    expect(status).toBe(0);
    expect(stdout).toContain("Renaming platform identifiers");

    const pbxproj = readFileSync(join(iosDir, "project.pbxproj"), "utf-8");
    expect(pbxproj).toContain("com.newname.app");
    expect(pbxproj).not.toContain("com.oldname.app");
  });

  test("reminds to run neutron generate", () => {
    setupWorkspace("oldname");
    const { status, stdout } = run(["rename", "newname"], tmpDir);
    expect(status).toBe(0);
    expect(stdout).toContain("neutron generate");
  });
});
