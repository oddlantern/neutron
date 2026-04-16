import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type { WorkspacePackage } from "@/graph/types";
import { schemaPlugin } from "@/plugins/builtin/domain/schema/plugin";
import type { ExecutionContext } from "@/plugins/types";

// Schema is a newly-added domain plugin parallel to design/openapi.
// These tests cover the three DomainPlugin methods: detectBridge,
// exportArtifact, and buildPipeline — mirroring the coverage design
// plugin has.

function makePackage(overrides?: Partial<WorkspacePackage>): WorkspacePackage {
  return {
    name: "schema-source",
    path: "packages/schema",
    ecosystem: "typescript",
    version: "1.0.0",
    dependencies: [],
    localDependencies: [],
    ...overrides,
  };
}

function makeContext(root: string, overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    graph: {
      name: "test-workspace",
      root,
      packages: new Map(),
      bridges: [],
    },
    packageManager: "bun",
    root,
    findEcosystemHandlers: async () => [],
    ...overrides,
  };
}

function withTmpDir<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "neutron-schema-test-"));
  return fn(tmp).finally(() => rmSync(tmp, { recursive: true, force: true }));
}

describe("schemaPlugin.detectBridge", () => {
  test("returns true for valid schema with top-level properties", async () => {
    await withTmpDir(async (tmp) => {
      writeFileSync(
        join(tmp, "user.schema.json"),
        JSON.stringify({
          title: "User",
          type: "object",
          properties: { id: { type: "string" }, name: { type: "string" } },
        }),
      );
      expect(await schemaPlugin.detectBridge("user.schema.json", tmp)).toBe(true);
    });
  });

  test("returns true for schema with $defs", async () => {
    await withTmpDir(async (tmp) => {
      writeFileSync(
        join(tmp, "models.schema.json"),
        JSON.stringify({
          $defs: {
            User: { type: "object", properties: { id: { type: "string" } } },
          },
        }),
      );
      expect(await schemaPlugin.detectBridge("models.schema.json", tmp)).toBe(true);
    });
  });

  test("returns true for schema with draft-07 definitions key", async () => {
    await withTmpDir(async (tmp) => {
      writeFileSync(
        join(tmp, "legacy.schema.json"),
        JSON.stringify({
          definitions: {
            Address: { type: "object", properties: { city: { type: "string" } } },
          },
        }),
      );
      expect(await schemaPlugin.detectBridge("legacy.schema.json", tmp)).toBe(true);
    });
  });

  test("returns false for non-.schema.json filename", async () => {
    await withTmpDir(async (tmp) => {
      writeFileSync(
        join(tmp, "tokens.json"),
        JSON.stringify({ properties: { x: { type: "string" } } }),
      );
      expect(await schemaPlugin.detectBridge("tokens.json", tmp)).toBe(false);
    });
  });

  test("returns false for malformed JSON", async () => {
    await withTmpDir(async (tmp) => {
      writeFileSync(join(tmp, "bad.schema.json"), "{{{ not json");
      expect(await schemaPlugin.detectBridge("bad.schema.json", tmp)).toBe(false);
    });
  });

  test("returns false for schema.json lacking properties/$defs/definitions", async () => {
    await withTmpDir(async (tmp) => {
      writeFileSync(join(tmp, "empty.schema.json"), JSON.stringify({ title: "Empty" }));
      expect(await schemaPlugin.detectBridge("empty.schema.json", tmp)).toBe(false);
    });
  });

  test("returns false for missing file", async () => {
    await withTmpDir(async (tmp) => {
      expect(await schemaPlugin.detectBridge("missing.schema.json", tmp)).toBe(false);
    });
  });
});

describe("schemaPlugin.exportArtifact", () => {
  test("succeeds with a valid single-type schema", async () => {
    await withTmpDir(async (tmp) => {
      writeFileSync(
        join(tmp, "user.schema.json"),
        JSON.stringify({
          title: "User",
          type: "object",
          properties: { id: { type: "string" }, age: { type: "integer" } },
          required: ["id"],
        }),
      );
      const pkg = makePackage();
      const ctx = makeContext(tmp);
      const result = await schemaPlugin.exportArtifact(pkg, "user.schema.json", tmp, ctx);
      expect(result.success).toBe(true);
      expect(result.summary).toContain("1 type");
    });
  });

  test("reports count for schemas with multiple definitions", async () => {
    await withTmpDir(async (tmp) => {
      writeFileSync(
        join(tmp, "models.schema.json"),
        JSON.stringify({
          $defs: {
            User: { type: "object", properties: { id: { type: "string" } } },
            Address: { type: "object", properties: { city: { type: "string" } } },
            Order: { type: "object", properties: { total: { type: "number" } } },
          },
        }),
      );
      const result = await schemaPlugin.exportArtifact(makePackage(), "models.schema.json", tmp, makeContext(tmp));
      expect(result.success).toBe(true);
      expect(result.summary).toContain("3 type");
    });
  });

  test("fails when schema file is missing", async () => {
    await withTmpDir(async (tmp) => {
      const result = await schemaPlugin.exportArtifact(makePackage(), "missing.schema.json", tmp, makeContext(tmp));
      expect(result.success).toBe(false);
      expect(result.summary).toContain("Failed to read schema");
    });
  });

  test("fails when schema has no type definitions", async () => {
    await withTmpDir(async (tmp) => {
      writeFileSync(join(tmp, "empty.schema.json"), JSON.stringify({ title: "Empty" }));
      const result = await schemaPlugin.exportArtifact(makePackage(), "empty.schema.json", tmp, makeContext(tmp));
      expect(result.success).toBe(false);
      expect(result.summary).toContain("Schema validation failed");
    });
  });
});

describe("schemaPlugin.buildPipeline", () => {
  test("returns a validate-schema step first", async () => {
    await withTmpDir(async (tmp) => {
      writeFileSync(
        join(tmp, "user.schema.json"),
        JSON.stringify({ properties: { id: { type: "string" } } }),
      );
      const steps = await schemaPlugin.buildPipeline!(
        makePackage(),
        "user.schema.json",
        [],
        tmp,
        makeContext(tmp),
      );
      expect(steps.length).toBeGreaterThanOrEqual(1);
      expect(steps[0].name).toBe("validate-schema");
      expect(steps[0].plugin).toBe("schema");
    });
  });

  test("validate step succeeds when schema is well-formed", async () => {
    await withTmpDir(async (tmp) => {
      writeFileSync(
        join(tmp, "user.schema.json"),
        JSON.stringify({
          properties: { id: { type: "string" }, name: { type: "string" } },
        }),
      );
      const [validateStep] = await schemaPlugin.buildPipeline!(
        makePackage(),
        "user.schema.json",
        [],
        tmp,
        makeContext(tmp),
      );
      const result = await validateStep.execute();
      expect(result.success).toBe(true);
      expect(result.summary).toContain("validated");
    });
  });

  test("validate step fails with clear message when schema is broken", async () => {
    await withTmpDir(async (tmp) => {
      writeFileSync(join(tmp, "bad.schema.json"), JSON.stringify({ title: "NoProps" }));
      const [validateStep] = await schemaPlugin.buildPipeline!(
        makePackage(),
        "bad.schema.json",
        [],
        tmp,
        makeContext(tmp),
      );
      const result = await validateStep.execute();
      expect(result.success).toBe(false);
      expect(result.summary).toContain("Schema validation failed");
    });
  });

  test("outputPaths on validate step point to the artifact", async () => {
    // The pipeline runner hashes outputPaths for change detection; if the
    // validate step didn't declare the schema file as output, every run
    // would be considered "changed" regardless of the schema's contents.
    await withTmpDir(async (tmp) => {
      writeFileSync(
        join(tmp, "user.schema.json"),
        JSON.stringify({ properties: { id: { type: "string" } } }),
      );
      const [validateStep] = await schemaPlugin.buildPipeline!(
        makePackage(),
        "user.schema.json",
        [],
        tmp,
        makeContext(tmp),
      );
      expect(validateStep.outputPaths).toContain("user.schema.json");
    });
  });
});
