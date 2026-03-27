import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const BIN = resolve(import.meta.dir, "..", "..", "dist", "bin.js");
const FIXTURE_CLEAN = resolve(import.meta.dir, "..", "fixture-clean");
const FIXTURE_ERRORS = resolve(import.meta.dir, "..", "fixture");

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

describe("check command", () => {
	test("exits 0 on clean fixture", () => {
		const { status } = run(["check"], FIXTURE_CLEAN);
		expect(status).toBe(0);
	});

	test("exits non-zero on fixture with errors", () => {
		const { status } = run(["check"], FIXTURE_ERRORS);
		expect(status).not.toBe(0);
	});
});

describe("check --quiet", () => {
	test("exits 0 on clean fixture with minimal output", () => {
		const { status, stdout } = run(["check", "--quiet"], FIXTURE_CLEAN);
		expect(status).toBe(0);
		// Quiet mode should produce less output than normal mode
		const normalResult = run(["check"], FIXTURE_CLEAN);
		expect(stdout.length).toBeLessThanOrEqual(normalResult.stdout.length);
	});
});

describe("install command", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mido-install-test-"));
		// Initialize a git repo so .git/hooks/ can be written
		spawnSync("git", ["init"], { cwd: tmpDir });
		// Write a minimal mido.yml
		writeFileSync(
			join(tmpDir, "mido.yml"),
			[
				"workspace: smoke-test",
				"ecosystems:",
				"  typescript:",
				"    manifest: package.json",
				"    packages:",
				"      - apps/server",
			].join("\n"),
			"utf-8",
		);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("creates git hook files", () => {
		const { status } = run(["install"], tmpDir);
		expect(status).toBe(0);

		const hooksDir = join(tmpDir, ".git", "hooks");
		expect(existsSync(join(hooksDir, "pre-commit"))).toBe(true);
		expect(existsSync(join(hooksDir, "commit-msg"))).toBe(true);
	});
});

describe("pre-commit command", () => {
	test("exits 0 on clean fixture", () => {
		const { status } = run(["pre-commit"], FIXTURE_CLEAN);
		expect(status).toBe(0);
	});
});
