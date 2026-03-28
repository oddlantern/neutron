import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { typescriptPlugin } from "../../src/plugins/builtin/typescript.js";
import { dartPlugin } from "../../src/plugins/builtin/dart.js";
import { STANDARD_ACTIONS } from "../../src/plugins/types.js";
import type { WorkspacePackage } from "../../src/graph/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePkg(overrides: Partial<WorkspacePackage> & { readonly name: string }): WorkspacePackage {
  return {
    path: overrides.path ?? "packages/test-pkg",
    ecosystem: overrides.ecosystem ?? "typescript",
    version: overrides.version ?? "1.0.0",
    dependencies: overrides.dependencies ?? [],
    localDependencies: overrides.localDependencies ?? [],
    ...overrides,
  };
}

// ─── TypeScript plugin ────────────────────────────────────────────────────────

describe("typescriptPlugin", () => {
  describe("metadata", () => {
    test("has correct type", () => {
      expect(typescriptPlugin.type).toBe("ecosystem");
    });

    test("has correct name", () => {
      expect(typescriptPlugin.name).toBe("typescript");
    });

    test("has correct manifest", () => {
      expect(typescriptPlugin.manifest).toBe("package.json");
    });
  });

  describe("detect", () => {
    test("returns true for typescript ecosystem package", async () => {
      const pkg = makePkg({ name: "my-lib", ecosystem: "typescript" });
      const result = await typescriptPlugin.detect(pkg, "/tmp");
      expect(result).toBe(true);
    });

    test("returns false for dart ecosystem package", async () => {
      const pkg = makePkg({ name: "my-lib", ecosystem: "dart" });
      const result = await typescriptPlugin.detect(pkg, "/tmp");
      expect(result).toBe(false);
    });

    test("returns false for unknown ecosystem", async () => {
      const pkg = makePkg({ name: "my-lib", ecosystem: "rust" });
      const result = await typescriptPlugin.detect(pkg, "/tmp");
      expect(result).toBe(false);
    });
  });

  describe("getWatchPatterns", () => {
    test("returns TypeScript file patterns", async () => {
      const pkg = makePkg({ name: "my-lib" });
      const patterns = await typescriptPlugin.getWatchPatterns(pkg, "/tmp");
      expect(patterns).toContain("src/**/*.ts");
      expect(patterns).toContain("src/**/*.tsx");
    });
  });

  describe("getActions", () => {
    const root = join(tmpdir(), `mido-ts-actions-${Date.now()}`);
    const pkgDir = join(root, "packages", "test-pkg");

    beforeAll(() => {
      mkdirSync(pkgDir, { recursive: true });
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    test("always includes lint, format, format:check", async () => {
      const pkg = makePkg({ name: "my-lib" });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "my-lib", scripts: {} }),
      );

      const actions = await typescriptPlugin.getActions(pkg, root);
      expect(actions).toContain(STANDARD_ACTIONS.LINT);
      expect(actions).toContain(STANDARD_ACTIONS.FORMAT);
      expect(actions).toContain(STANDARD_ACTIONS.FORMAT_CHECK);
    });

    test("includes build when build script exists", async () => {
      const pkg = makePkg({ name: "my-lib" });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "my-lib", scripts: { build: "tsdown" } }),
      );

      const actions = await typescriptPlugin.getActions(pkg, root);
      expect(actions).toContain(STANDARD_ACTIONS.BUILD);
    });

    test("includes typecheck when typescript is a dependency", async () => {
      const pkg = makePkg({ name: "my-lib" });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "my-lib",
          devDependencies: { typescript: "^5.0.0" },
          scripts: {},
        }),
      );

      const actions = await typescriptPlugin.getActions(pkg, root);
      expect(actions).toContain(STANDARD_ACTIONS.TYPECHECK);
    });

    test("includes typecheck when tsconfig.json exists", async () => {
      const pkg = makePkg({ name: "my-lib" });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "my-lib", scripts: {} }),
      );
      writeFileSync(join(pkgDir, "tsconfig.json"), "{}");

      const actions = await typescriptPlugin.getActions(pkg, root);
      expect(actions).toContain(STANDARD_ACTIONS.TYPECHECK);

      // Cleanup tsconfig so it doesn't affect other tests
      rmSync(join(pkgDir, "tsconfig.json"), { force: true });
    });

    test("includes well-known script actions", async () => {
      const pkg = makePkg({ name: "my-lib" });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "my-lib",
          scripts: { generate: "openapi-typescript spec.json -o api.d.ts", dev: "vite" },
        }),
      );

      const actions = await typescriptPlugin.getActions(pkg, root);
      expect(actions).toContain("generate");
      expect(actions).toContain("dev");
    });

    test("returns empty array when manifest is unreadable", async () => {
      const pkg = makePkg({ name: "ghost", path: "packages/ghost" });
      const actions = await typescriptPlugin.getActions(pkg, root);
      expect(actions).toEqual([]);
    });
  });

  describe("canHandleDomainArtifact", () => {
    const root = join(tmpdir(), `mido-ts-domain-${Date.now()}`);
    const pkgDir = join(root, "packages", "test-pkg");

    beforeAll(() => {
      mkdirSync(pkgDir, { recursive: true });
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    test("returns capability for openapi domain when openapi-typescript dep exists", async () => {
      const pkg = makePkg({ name: "my-client", ecosystem: "typescript" });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "my-client",
          devDependencies: { "openapi-typescript": "^7.0.0" },
        }),
      );

      const result = await typescriptPlugin.canHandleDomainArtifact!(
        "openapi",
        "openapi.json",
        pkg,
        root,
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("generate-openapi-ts");
      expect(result!.description).toContain("openapi-typescript");
    });

    test("accepts openapi domain for any TS package (outputDir convention)", async () => {
      const pkg = makePkg({ name: "my-client", ecosystem: "typescript" });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "my-client" }),
      );

      const result = await typescriptPlugin.canHandleDomainArtifact!(
        "openapi",
        "openapi.json",
        pkg,
        root,
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("generate-openapi-ts");
    });

    test("returns capability for design-tokens domain with typescript package", async () => {
      const pkg = makePkg({ name: "design-tokens", ecosystem: "typescript" });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "design-tokens" }),
      );

      const result = await typescriptPlugin.canHandleDomainArtifact!(
        "design-tokens",
        "tokens.json",
        pkg,
        root,
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("generate-design-tokens-css");
    });

    test("returns capability for design-tokens when package does not exist yet", async () => {
      const pkg = makePkg({ name: "new-tokens", path: "packages/new-tokens", ecosystem: "typescript" });

      const result = await typescriptPlugin.canHandleDomainArtifact!(
        "design-tokens",
        "tokens.json",
        pkg,
        root,
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("generate-design-tokens-css");
    });

    test("returns null for unknown domain", async () => {
      const pkg = makePkg({ name: "my-client", ecosystem: "typescript" });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "my-client" }),
      );

      const result = await typescriptPlugin.canHandleDomainArtifact!(
        "graphql",
        "schema.graphql",
        pkg,
        root,
      );
      expect(result).toBeNull();
    });
  });

  describe("suggestWatchPaths", () => {
    const root = join(tmpdir(), `mido-ts-watch-${Date.now()}`);
    const pkgDir = join(root, "packages", "test-pkg");

    beforeAll(() => {
      mkdirSync(pkgDir, { recursive: true });
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    test("suggests src/** when src dir exists", async () => {
      mkdirSync(join(pkgDir, "src"), { recursive: true });

      const pkg = makePkg({ name: "my-lib" });
      const result = await typescriptPlugin.suggestWatchPaths!(pkg, root);
      expect(result).not.toBeNull();
      expect(result!.paths).toContain("packages/test-pkg/src/**");
    });

    test("suggests package root when no src dir", async () => {
      const noSrcRoot = join(tmpdir(), `mido-ts-nosrc-${Date.now()}`);
      const noSrcPkgDir = join(noSrcRoot, "packages", "flat-pkg");
      mkdirSync(noSrcPkgDir, { recursive: true });

      const pkg = makePkg({ name: "flat", path: "packages/flat-pkg" });
      const result = await typescriptPlugin.suggestWatchPaths!(pkg, noSrcRoot);
      expect(result).not.toBeNull();
      expect(result!.paths).toContain("packages/flat-pkg/**");

      rmSync(noSrcRoot, { recursive: true, force: true });
    });
  });
});

// ─── Dart plugin ──────────────────────────────────────────────────────────────

describe("dartPlugin", () => {
  describe("metadata", () => {
    test("has correct type", () => {
      expect(dartPlugin.type).toBe("ecosystem");
    });

    test("has correct name", () => {
      expect(dartPlugin.name).toBe("dart");
    });

    test("has correct manifest", () => {
      expect(dartPlugin.manifest).toBe("pubspec.yaml");
    });
  });

  describe("detect", () => {
    test("returns true for dart ecosystem package", async () => {
      const pkg = makePkg({ name: "my_dart_lib", ecosystem: "dart" });
      const result = await dartPlugin.detect(pkg, "/tmp");
      expect(result).toBe(true);
    });

    test("returns false for typescript ecosystem package", async () => {
      const pkg = makePkg({ name: "my-lib", ecosystem: "typescript" });
      const result = await dartPlugin.detect(pkg, "/tmp");
      expect(result).toBe(false);
    });

    test("returns false for unknown ecosystem", async () => {
      const pkg = makePkg({ name: "my-lib", ecosystem: "rust" });
      const result = await dartPlugin.detect(pkg, "/tmp");
      expect(result).toBe(false);
    });
  });

  describe("getWatchPatterns", () => {
    test("returns Dart file patterns", async () => {
      const pkg = makePkg({ name: "my_dart_lib", ecosystem: "dart" });
      const patterns = await dartPlugin.getWatchPatterns(pkg, "/tmp");
      expect(patterns).toContain("lib/**/*.dart");
      expect(patterns).toContain("bin/**/*.dart");
    });
  });

  describe("getActions", () => {
    const root = join(tmpdir(), `mido-dart-actions-${Date.now()}`);
    const pkgDir = join(root, "packages", "test-pkg");

    beforeAll(() => {
      mkdirSync(pkgDir, { recursive: true });
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    test("always includes pub-get, lint, format, format:check", async () => {
      const pkg = makePkg({ name: "my_dart_lib", ecosystem: "dart" });
      writeFileSync(
        join(pkgDir, "pubspec.yaml"),
        "name: my_dart_lib\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n",
      );

      const actions = await dartPlugin.getActions(pkg, root);
      expect(actions).toContain("pub-get");
      expect(actions).toContain(STANDARD_ACTIONS.LINT);
      expect(actions).toContain(STANDARD_ACTIONS.FORMAT);
      expect(actions).toContain(STANDARD_ACTIONS.FORMAT_CHECK);
    });

    test("includes build and codegen when build_runner dep exists", async () => {
      const pkg = makePkg({ name: "my_dart_lib", ecosystem: "dart" });
      writeFileSync(
        join(pkgDir, "pubspec.yaml"),
        [
          "name: my_dart_lib",
          "environment:",
          "  sdk: '>=3.0.0 <4.0.0'",
          "dev_dependencies:",
          "  build_runner: ^2.0.0",
        ].join("\n") + "\n",
      );

      const actions = await dartPlugin.getActions(pkg, root);
      expect(actions).toContain(STANDARD_ACTIONS.BUILD);
      expect(actions).toContain("codegen");
    });

    test("includes generate-api when swagger_parser dep exists", async () => {
      const pkg = makePkg({ name: "my_dart_lib", ecosystem: "dart" });
      writeFileSync(
        join(pkgDir, "pubspec.yaml"),
        [
          "name: my_dart_lib",
          "environment:",
          "  sdk: '>=3.0.0 <4.0.0'",
          "dev_dependencies:",
          "  swagger_parser: ^1.0.0",
        ].join("\n") + "\n",
      );

      const actions = await dartPlugin.getActions(pkg, root);
      expect(actions).toContain("generate-api");
    });

    test("returns [pub-get] when manifest is unreadable", async () => {
      const pkg = makePkg({ name: "ghost", path: "packages/ghost", ecosystem: "dart" });
      const actions = await dartPlugin.getActions(pkg, root);
      expect(actions).toEqual(["pub-get"]);
    });
  });

  describe("canHandleDomainArtifact", () => {
    const root = join(tmpdir(), `mido-dart-domain-${Date.now()}`);
    const pkgDir = join(root, "packages", "test-pkg");

    beforeAll(() => {
      mkdirSync(pkgDir, { recursive: true });
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    test("returns capability for openapi when swagger_parser dep exists", async () => {
      const pkg = makePkg({ name: "api_client", ecosystem: "dart" });
      writeFileSync(
        join(pkgDir, "pubspec.yaml"),
        [
          "name: api_client",
          "environment:",
          "  sdk: '>=3.0.0 <4.0.0'",
          "dev_dependencies:",
          "  swagger_parser: ^1.0.0",
        ].join("\n") + "\n",
      );

      const result = await dartPlugin.canHandleDomainArtifact!(
        "openapi",
        "openapi.json",
        pkg,
        root,
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("generate-openapi-dart");
      expect(result!.description).toContain("swagger_parser");
    });

    test("accepts openapi for any dart package (outputDir convention)", async () => {
      const pkg = makePkg({ name: "api_client", ecosystem: "dart" });
      writeFileSync(
        join(pkgDir, "pubspec.yaml"),
        "name: api_client\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n",
      );

      const result = await dartPlugin.canHandleDomainArtifact!(
        "openapi",
        "openapi.json",
        pkg,
        root,
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("generate-openapi-dart");
    });

    test("returns capability for design-tokens when target does not exist", async () => {
      const pkg = makePkg({ name: "new_tokens", path: "packages/new-tokens", ecosystem: "dart" });

      const result = await dartPlugin.canHandleDomainArtifact!(
        "design-tokens",
        "tokens.json",
        pkg,
        root,
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("generate-design-tokens");
    });

    test("returns capability for design-tokens when Flutter package exists", async () => {
      const pkg = makePkg({ name: "design_system", ecosystem: "dart" });
      writeFileSync(
        join(pkgDir, "pubspec.yaml"),
        [
          "name: design_system",
          "environment:",
          "  sdk: '>=3.0.0 <4.0.0'",
          "dependencies:",
          "  flutter:",
          "    sdk: flutter",
        ].join("\n") + "\n",
      );

      const result = await dartPlugin.canHandleDomainArtifact!(
        "design-tokens",
        "tokens.json",
        pkg,
        root,
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("generate-design-tokens");
    });

    test("returns null for design-tokens when non-Flutter dart package", async () => {
      const pkg = makePkg({ name: "plain_dart", ecosystem: "dart" });
      writeFileSync(
        join(pkgDir, "pubspec.yaml"),
        "name: plain_dart\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n",
      );

      const result = await dartPlugin.canHandleDomainArtifact!(
        "design-tokens",
        "tokens.json",
        pkg,
        root,
      );
      expect(result).toBeNull();
    });

    test("returns null for unknown domain", async () => {
      const pkg = makePkg({ name: "api_client", ecosystem: "dart" });
      writeFileSync(
        join(pkgDir, "pubspec.yaml"),
        "name: api_client\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n",
      );

      const result = await dartPlugin.canHandleDomainArtifact!(
        "graphql",
        "schema.graphql",
        pkg,
        root,
      );
      expect(result).toBeNull();
    });
  });

  describe("suggestWatchPaths", () => {
    const root = join(tmpdir(), `mido-dart-watch-${Date.now()}`);
    const pkgDir = join(root, "packages", "test-pkg");

    beforeAll(() => {
      mkdirSync(pkgDir, { recursive: true });
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    test("suggests lib/** when lib dir exists", async () => {
      mkdirSync(join(pkgDir, "lib"), { recursive: true });

      const pkg = makePkg({ name: "my_dart_lib", ecosystem: "dart" });
      const result = await dartPlugin.suggestWatchPaths!(pkg, root);
      expect(result).not.toBeNull();
      expect(result!.paths).toContain("packages/test-pkg/lib/**");
    });

    test("suggests package root when no lib dir", async () => {
      const noLibRoot = join(tmpdir(), `mido-dart-nolib-${Date.now()}`);
      const noLibPkgDir = join(noLibRoot, "packages", "flat-pkg");
      mkdirSync(noLibPkgDir, { recursive: true });

      const pkg = makePkg({ name: "flat", path: "packages/flat-pkg", ecosystem: "dart" });
      const result = await dartPlugin.suggestWatchPaths!(pkg, noLibRoot);
      expect(result).not.toBeNull();
      expect(result!.paths).toContain("packages/flat-pkg/**");

      rmSync(noLibRoot, { recursive: true, force: true });
    });
  });
});
