import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import type { WorkspacePackage } from "../../graph/types.js";
import type {
  DomainCapability,
  EcosystemPlugin,
  ExecuteResult,
  ExecutionContext,
  WatchPathSuggestion,
} from "../types.js";
import { STANDARD_ACTIONS } from "../types.js";
import { isRecord, runCommand } from "./exec.js";

const WATCH_PATTERNS: readonly string[] = ["lib/**/*.dart", "bin/**/*.dart"];

async function readPubspec(pkg: WorkspacePackage, root: string): Promise<Record<string, unknown>> {
  const manifestPath = join(root, pkg.path, "pubspec.yaml");
  const content = await readFile(manifestPath, "utf-8");
  const parsed: unknown = parseYaml(content);
  if (!isRecord(parsed)) {
    throw new Error(`Expected object in ${manifestPath}`);
  }
  return parsed;
}

function hasDep(manifest: Record<string, unknown>, name: string): boolean {
  const fields = ["dependencies", "dev_dependencies", "dependency_overrides"];
  for (const field of fields) {
    const deps = manifest[field];
    if (isRecord(deps) && name in deps) {
      return true;
    }
  }
  return false;
}

function isFlutterPackage(manifest: Record<string, unknown>): boolean {
  const deps = manifest["dependencies"];
  if (!isRecord(deps)) {
    return false;
  }
  return "flutter" in deps;
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
      const actions: string[] = ["pub-get"];

      // Standard actions — always available for Dart packages
      actions.push(STANDARD_ACTIONS.LINT);
      actions.push(STANDARD_ACTIONS.FORMAT);
      actions.push(STANDARD_ACTIONS.FORMAT_CHECK);

      // Build — only if build_runner is available
      if (hasDep(manifest, "build_runner")) {
        actions.push(STANDARD_ACTIONS.BUILD);
        actions.push("codegen");
      }

      if (hasDep(manifest, "swagger_parser")) {
        actions.push("generate-api");
      }

      return actions;
    } catch {
      return ["pub-get"];
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
      case STANDARD_ACTIONS.LINT:
        if (context.resolvedFiles && context.resolvedFiles.length > 0) {
          return runCommand(analyzeCmd, ["analyze", ...context.resolvedFiles], cwd);
        }
        return runCommand(analyzeCmd, ["analyze", "."], cwd);

      case STANDARD_ACTIONS.LINT_FIX:
        if (context.resolvedFiles && context.resolvedFiles.length > 0) {
          return runCommand("dart", ["fix", "--apply", ...context.resolvedFiles], cwd);
        }
        return runCommand("dart", ["fix", "--apply", "."], cwd);

      case STANDARD_ACTIONS.FORMAT: {
        if (context.resolvedFiles && context.resolvedFiles.length > 0) {
          return runCommand("dart", ["format", ...context.resolvedFiles], cwd);
        }
        const libDir = join(cwd, "lib");
        const binDir = join(cwd, "bin");
        const targets = [libDir];
        if (existsSync(binDir)) {
          targets.push(binDir);
        }
        return runCommand("dart", ["format", ...targets], cwd);
      }

      case STANDARD_ACTIONS.FORMAT_CHECK: {
        if (context.resolvedFiles && context.resolvedFiles.length > 0) {
          return runCommand(
            "dart",
            ["format", "--set-exit-if-changed", ...context.resolvedFiles],
            cwd,
          );
        }
        const libDir = join(cwd, "lib");
        const binDir = join(cwd, "bin");
        const targets = [libDir];
        if (existsSync(binDir)) {
          targets.push(binDir);
        }
        return runCommand("dart", ["format", "--set-exit-if-changed", ...targets], cwd);
      }

      case STANDARD_ACTIONS.BUILD:
        return runCommand(
          "dart",
          ["run", "build_runner", "build", "--delete-conflicting-outputs"],
          cwd,
        );

      case "pub-get":
        return runCommand(dartCmd, ["pub", "get"], cwd);

      case "codegen":
        return runCommand(
          "dart",
          ["run", "build_runner", "build", "--delete-conflicting-outputs"],
          cwd,
        );

      case "generate-api":
        return runCommand("dart", ["run", "swagger_parser"], cwd);

      case "generate-openapi-dart": {
        // Run swagger_parser then build_runner
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
    root: string,
  ): Promise<DomainCapability | null> {
    if (domain !== "openapi") {
      return null;
    }

    try {
      const manifest = await readPubspec(pkg, root);
      if (hasDep(manifest, "swagger_parser")) {
        return {
          action: "generate-openapi-dart",
          description: "Dart client via swagger_parser + build_runner",
        };
      }
    } catch {
      // manifest unreadable
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
