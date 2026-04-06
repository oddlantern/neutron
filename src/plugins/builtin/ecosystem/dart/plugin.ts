import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import type { WorkspacePackage } from "@/graph/types";
import type {
  DomainCapability,
  EcosystemPlugin,
  ExecuteResult,
  ExecutionContext,
  WatchPathSuggestion,
} from "@/plugins/types";
import { STANDARD_ACTIONS } from "@/plugins/types";
import type { ValidatedTokens } from "@/plugins/builtin/domain/design/types";
import {
  generateBarrel,
  generateColorScheme,
  generateConstants,
  generatePackageBarrel,
  generateTheme,
  generateThemeExtensions,
} from "@/plugins/builtin/ecosystem/dart/token-codegen";
import { hasDep, hasResolvedFiles, isRecord, runCommand } from "@/plugins/builtin/shared/exec";
import { executeDartAssetGeneration } from "@/plugins/builtin/ecosystem/dart/asset-codegen";
import { executeOpenAPIDartGeneration } from "@/plugins/builtin/ecosystem/dart/openapi-codegen";
import { executeSchemaGeneration as executeDartSchemaGeneration } from "@/plugins/builtin/ecosystem/dart/schema-codegen";

/** Dart-specific dependency fields */
const DART_DEP_FIELDS: readonly string[] = [
  "dependencies",
  "dev_dependencies",
  "dependency_overrides",
];

/**
 * Narrow unknown domainData to ValidatedTokens.
 * ValidatedTokens always has a `color` object at the top level.
 */
function isValidatedTokens(value: unknown): value is ValidatedTokens {
  if (!isRecord(value)) {
    return false;
  }
  if (!isRecord(value["standard"])) {
    return false;
  }
  return typeof value["standard"]["color"] === "object" && value["standard"]["color"] !== null;
}

const WATCH_PATTERNS: readonly string[] = ["lib/**/*.dart", "bin/**/*.dart"];

/** Action names for Dart-specific operations */
const ACTION_PUB_GET = "pub-get";
const ACTION_CODEGEN = "codegen";
const ACTION_GENERATE_API = "generate-api";
const ACTION_GENERATE_OPENAPI_DART = "generate-openapi-dart";
const ACTION_GENERATE_DESIGN_TOKENS = "generate-design-tokens";
const ACTION_GENERATE_ASSETS = "generate-assets";
const ACTION_GENERATE_SCHEMA_DART = "generate-schema-dart";

async function readPubspec(pkg: WorkspacePackage, root: string): Promise<Record<string, unknown>> {
  const manifestPath = join(root, pkg.path, "pubspec.yaml");
  const content = await readFile(manifestPath, "utf-8");
  const parsed: unknown = parseYaml(content);
  if (!isRecord(parsed)) {
    throw new Error(`Expected object in ${manifestPath}`);
  }
  return parsed;
}

function isFlutterPackage(manifest: Record<string, unknown>): boolean {
  const deps = manifest["dependencies"];
  if (!isRecord(deps)) {
    return false;
  }
  return "flutter" in deps;
}

/**
 * Scaffold a Flutter package at the given path if it doesn't exist.
 * Creates pubspec.yaml, lib/ structure, and package barrel.
 */
function scaffoldDartPackage(pkgDir: string, packageName: string, tokens: ValidatedTokens): void {
  const libDir = join(pkgDir, "lib");
  const themeDir = join(libDir, "core", "theme");
  const generatedDir = join(themeDir, "generated");

  mkdirSync(generatedDir, { recursive: true });

  const needsGoogleFonts = tokens.standard.typography?.provider === "google_fonts";

  const pubspec = [
    `name: ${packageName}`,
    "publish_to: none",
    "",
    "environment:",
    "  sdk: '>=3.0.0 <4.0.0'",
    "  flutter: '>=3.10.0'",
    "",
    "dependencies:",
    "  flutter:",
    "    sdk: flutter",
  ];

  if (needsGoogleFonts) {
    pubspec.push("  google_fonts: '>=6.0.0'");
  }

  pubspec.push("");
  writeFileSync(join(pkgDir, "pubspec.yaml"), pubspec.join("\n"), "utf-8");
}

/**
 * Execute design token generation for a Dart/Flutter target.
 *
 * When context.outputDir is set (new convention), writes to that directory
 * (`<source>/generated/dart/`). Falls back to `<consumer>/` for backwards
 * compatibility.
 */
async function executeDesignTokenGeneration(
  pkg: WorkspacePackage,
  root: string,
  context: ExecutionContext,
): Promise<ExecuteResult> {
  const start = performance.now();

  const rawDomainData = context.domainData;
  if (!isValidatedTokens(rawDomainData)) {
    return {
      success: false,
      duration: 0,
      summary: "No token data provided — design plugin must validate first",
    };
  }
  const tokens: ValidatedTokens = rawDomainData;

  // Determine output root — new convention writes next to source, not into consumer
  const outRoot = context.outputDir ?? join(root, pkg.path);
  const workspace = context.graph.name.replace(/-/g, "_").replace(/@/g, "").replace(/\//g, "_");
  // Strip npm scope if present (e.g. "@nextsaga/api" → "api")
  const rawSource = (context.sourceName ?? "generated").replace(/^@[^/]+\//, "");
  const source = rawSource.replace(/-/g, "_").replace(/@/g, "").replace(/\//g, "_");
  const packageName = workspace ? `${workspace}_${source}` : source;

  // Always regenerate pubspec — dependencies may change (e.g., google_fonts toggle)
  scaffoldDartPackage(outRoot, packageName, tokens);

  const themeDir = join(outRoot, "lib", "core", "theme");
  const generatedDir = join(themeDir, "generated");
  mkdirSync(generatedDir, { recursive: true });

  // Generate files
  const colorSchemeContent = generateColorScheme(tokens);
  const extensionsContent = generateThemeExtensions(tokens);
  const constantsContent = generateConstants(tokens);
  const themeContent = generateTheme(tokens, packageName);

  const COLOR_SCHEME_FILE = "color_scheme.generated.dart";
  const EXTENSIONS_FILE = "theme_extensions.generated.dart";
  const CONSTANTS_FILE = "constants.generated.dart";
  const generatedFiles = [COLOR_SCHEME_FILE, EXTENSIONS_FILE, CONSTANTS_FILE];

  writeFileSync(join(generatedDir, COLOR_SCHEME_FILE), colorSchemeContent, "utf-8");
  writeFileSync(join(generatedDir, EXTENSIONS_FILE), extensionsContent, "utf-8");
  writeFileSync(join(generatedDir, CONSTANTS_FILE), constantsContent, "utf-8");

  // Barrel for generated/
  const barrelContent = generateBarrel(generatedFiles);
  writeFileSync(join(generatedDir, "generated.dart"), barrelContent, "utf-8");

  // theme.dart (ThemeData assembly)
  writeFileSync(join(themeDir, "theme.dart"), themeContent, "utf-8");

  // Package barrel
  mkdirSync(join(outRoot, "lib"), { recursive: true });
  const packageBarrelContent = generatePackageBarrel(packageName);
  writeFileSync(join(outRoot, "lib", `${packageName}.dart`), packageBarrelContent, "utf-8");

  // Resolve dependencies
  const pubGetResult = await runCommand("dart", ["pub", "get"], outRoot);
  if (!pubGetResult.success) {
    return {
      success: false,
      duration: Math.round(performance.now() - start),
      summary: `dart pub get failed in generated package`,
      output: pubGetResult.output,
    };
  }

  const duration = Math.round(performance.now() - start);
  const fileCount = generatedFiles.length + 3; // + barrel + theme + package barrel

  return {
    success: true,
    duration,
    summary: `${fileCount} Dart files written`,
  };
}

export const dartPlugin: EcosystemPlugin = {
  type: "ecosystem",
  name: "dart",
  manifest: "pubspec.yaml",

  async detect(pkg: WorkspacePackage): Promise<boolean> {
    return pkg.ecosystem === "dart";
  },

  async getWatchPatterns(): Promise<readonly string[]> {
    return WATCH_PATTERNS;
  },

  async getActions(pkg: WorkspacePackage, root: string): Promise<readonly string[]> {
    try {
      const manifest = await readPubspec(pkg, root);
      const actions: string[] = [ACTION_PUB_GET];

      // Standard actions — always available for Dart packages
      actions.push(STANDARD_ACTIONS.LINT);
      actions.push(STANDARD_ACTIONS.FORMAT);
      actions.push(STANDARD_ACTIONS.FORMAT_CHECK);

      // Build — only if build_runner is available
      if (hasDep(manifest, "build_runner", DART_DEP_FIELDS)) {
        actions.push(STANDARD_ACTIONS.BUILD);
        actions.push(ACTION_CODEGEN);
      }

      // Test — always available for Dart packages
      actions.push(STANDARD_ACTIONS.TEST);

      if (hasDep(manifest, "swagger_parser", DART_DEP_FIELDS)) {
        actions.push(ACTION_GENERATE_API);
      }

      return actions;
    } catch {
      return [ACTION_PUB_GET];
    }
  },

  async execute(
    action: string,
    pkg: WorkspacePackage,
    root: string,
    context: ExecutionContext,
  ): Promise<ExecuteResult> {
    const cwd = join(root, pkg.path);

    let manifest: Record<string, unknown>;
    try {
      manifest = await readPubspec(pkg, root);
    } catch {
      manifest = {};
    }

    const flutter = isFlutterPackage(manifest);
    const dartCmd = flutter ? "flutter" : "dart";
    const analyzeCmd = flutter ? "flutter" : "dart";

    switch (action) {
      case STANDARD_ACTIONS.LINT: {
        const args = ["analyze"];
        // Dart lint.dart.strict → --fatal-infos
        if (context.lintDart?.strict) {
          args.push("--fatal-infos");
        }
        if (hasResolvedFiles(context)) {
          args.push(...context.resolvedFiles!);
        } else {
          args.push(".");
        }
        return runCommand(analyzeCmd, args, cwd);
      }

      case STANDARD_ACTIONS.LINT_FIX:
        if (hasResolvedFiles(context)) {
          return runCommand("dart", ["fix", "--apply", ...context.resolvedFiles!], cwd);
        }
        return runCommand("dart", ["fix", "--apply", "."], cwd);

      case STANDARD_ACTIONS.FORMAT: {
        const args = ["format"];
        // Dart format.dart.lineLength → --line-length
        if (context.formatDart?.lineLength) {
          args.push("--line-length", String(context.formatDart.lineLength));
        }
        if (hasResolvedFiles(context)) {
          args.push(...context.resolvedFiles!);
        } else {
          const libDir = join(cwd, "lib");
          const binDir = join(cwd, "bin");
          const targets = [libDir];
          if (existsSync(binDir)) {
            targets.push(binDir);
          }
          args.push(...targets);
        }
        return runCommand("dart", args, cwd);
      }

      case STANDARD_ACTIONS.FORMAT_CHECK: {
        const args = ["format", "--set-exit-if-changed"];
        // Dart format.dart.lineLength → --line-length
        if (context.formatDart?.lineLength) {
          args.push("--line-length", String(context.formatDart.lineLength));
        }
        if (hasResolvedFiles(context)) {
          args.push(...context.resolvedFiles!);
        } else {
          const libDir = join(cwd, "lib");
          const binDir = join(cwd, "bin");
          const targets = [libDir];
          if (existsSync(binDir)) {
            targets.push(binDir);
          }
          args.push(...targets);
        }
        return runCommand("dart", args, cwd);
      }

      case STANDARD_ACTIONS.BUILD:
      case ACTION_CODEGEN:
        return runCommand(
          "dart",
          ["run", "build_runner", "build", "--delete-conflicting-outputs"],
          cwd,
        );

      case STANDARD_ACTIONS.TEST: {
        const testCmd = flutter ? "flutter" : "dart";
        return runCommand(testCmd, ["test"], cwd);
      }

      case ACTION_PUB_GET:
        return runCommand(dartCmd, ["pub", "get"], cwd);

      case ACTION_GENERATE_API:
        return runCommand("dart", ["run", "swagger_parser"], cwd);

      case ACTION_GENERATE_OPENAPI_DART: {
        // New convention: generate into outputDir
        if (context.outputDir) {
          return executeOpenAPIDartGeneration(pkg, root, context);
        }
        // Legacy: run in consumer package
        const swaggerResult = await runCommand("dart", ["run", "swagger_parser"], cwd);
        if (!swaggerResult.success) {
          return swaggerResult;
        }
        return runCommand(
          "dart",
          ["run", "build_runner", "build", "--delete-conflicting-outputs"],
          cwd,
        );
      }

      case ACTION_GENERATE_DESIGN_TOKENS: {
        return executeDesignTokenGeneration(pkg, root, context);
      }

      case ACTION_GENERATE_ASSETS: {
        return executeDartAssetGeneration(pkg, root, context);
      }

      case ACTION_GENERATE_SCHEMA_DART: {
        return executeDartSchemaGeneration(pkg, root, context);
      }

      default:
        return {
          success: false,
          duration: 0,
          summary: `Unknown action: ${action}`,
        };
    }
  },

  async canHandleDomainArtifact(
    domain: string,
    _artifact: string,
    pkg: WorkspacePackage,
    _root: string,
  ): Promise<DomainCapability | null> {
    if (pkg.ecosystem !== "dart") {
      return null;
    }

    if (domain === "design-tokens") {
      return {
        action: ACTION_GENERATE_DESIGN_TOKENS,
        description: "Flutter theme (M3 ColorScheme, extensions, constants)",
      };
    }

    if (domain === "openapi") {
      return {
        action: ACTION_GENERATE_OPENAPI_DART,
        description: "Dart client via swagger_parser + build_runner",
      };
    }

    if (domain === "assets") {
      return {
        action: ACTION_GENERATE_ASSETS,
        description: "Flutter typed asset wrappers + pubspec declarations",
      };
    }

    if (domain === "schema") {
      return {
        action: ACTION_GENERATE_SCHEMA_DART,
        description: "Dart classes from JSON Schema",
      };
    }

    return null;
  },

  async suggestWatchPaths(
    pkg: WorkspacePackage,
    root: string,
  ): Promise<WatchPathSuggestion | null> {
    const libDir = join(root, pkg.path, "lib");
    if (existsSync(libDir)) {
      return {
        paths: [`${pkg.path}/lib/**`],
        reason: `Dart source in ${pkg.path}/lib/`,
      };
    }

    return {
      paths: [`${pkg.path}/**`],
      reason: `Package root of ${pkg.path}`,
    };
  },
};
