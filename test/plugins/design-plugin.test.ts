import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import { designPlugin } from "@/plugins/builtin/domain/design/plugin";
import type { WorkspacePackage } from "@/graph/types";
import type { ExecutionContext } from "@/plugins/types";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");

function makePackage(overrides?: Partial<WorkspacePackage>): WorkspacePackage {
	return {
		name: "test",
		path: "test/fixture-tokens",
		ecosystem: "typescript",
		version: "1.0.0",
		dependencies: [],
		localDependencies: [],
		...overrides,
	};
}

function makeContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
	return {
		graph: {
			name: "test-workspace",
			root: PROJECT_ROOT,
			packages: new Map(),
			bridges: [],
		},
		packageManager: "bun",
		root: PROJECT_ROOT,
		findEcosystemHandlers: async () => [],
		...overrides,
	};
}

describe("designPlugin.detectBridge", () => {
	test("returns true for valid tokens.json", async () => {
		const result = await designPlugin.detectBridge("test/fixture-tokens/tokens.json", PROJECT_ROOT);
		expect(result).toBe(true);
	});

	test("returns false for non-JSON file", async () => {
		const result = await designPlugin.detectBridge("README.md", PROJECT_ROOT);
		expect(result).toBe(false);
	});

	test("returns false for JSON without color key", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "neutron-test-"));
		const filePath = join(tmp, "no-color.json");
		writeFileSync(filePath, JSON.stringify({ foo: "bar" }));

		try {
			const result = await designPlugin.detectBridge("no-color.json", tmp);
			expect(result).toBe(false);
		} finally {
			rmSync(tmp, { recursive: true });
		}
	});
});

describe("designPlugin.exportArtifact", () => {
	test("succeeds with valid tokens", async () => {
		const pkg = makePackage();
		const ctx = makeContext();
		const result = await designPlugin.exportArtifact(pkg, "test/fixture-tokens/tokens.json", PROJECT_ROOT, ctx);

		expect(result.success).toBe(true);
		expect(result.summary).toBe("tokens valid");
		expect(result.duration).toBeGreaterThanOrEqual(0);
	});

	test("fails with invalid tokens", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "neutron-test-"));
		const filePath = join(tmp, "bad-tokens.json");
		writeFileSync(filePath, JSON.stringify({ color: { invalid: 123 } }));

		try {
			const pkg = makePackage({ path: tmp });
			const ctx = makeContext({ root: tmp });
			const result = await designPlugin.exportArtifact(pkg, "bad-tokens.json", tmp, ctx);

			expect(result.success).toBe(false);
			expect(result.duration).toBeGreaterThanOrEqual(0);
		} finally {
			rmSync(tmp, { recursive: true });
		}
	});
});

describe("designPlugin.buildPipeline", () => {
	test("returns validate step", async () => {
		const pkg = makePackage();
		const ctx = makeContext();

		const steps = await designPlugin.buildPipeline!(
			pkg,
			"test/fixture-tokens/tokens.json",
			[],
			PROJECT_ROOT,
			ctx,
		);

		expect(steps.length).toBeGreaterThanOrEqual(1);

		const validateStep = steps.find((s) => s.name === "validate-tokens");
		expect(validateStep).toBeDefined();
		expect(validateStep!.plugin).toBe("design");
		expect(validateStep!.description).toBe("validating tokens...");
	});

	test("validate step succeeds with valid tokens", async () => {
		const pkg = makePackage();
		const ctx = makeContext();

		const steps = await designPlugin.buildPipeline!(
			pkg,
			"test/fixture-tokens/tokens.json",
			[],
			PROJECT_ROOT,
			ctx,
		);

		const validateStep = steps.find((s) => s.name === "validate-tokens");
		expect(validateStep).toBeDefined();

		const result = await validateStep!.execute();
		expect(result.success).toBe(true);
		expect(result.summary).toBe("tokens valid");
		expect(result.duration).toBeGreaterThanOrEqual(0);
	});
});
