import { existsSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type {
  DomainCapability,
  EcosystemPlugin,
  ExecuteResult,
  ExecutionContext,
} from "@/plugins/types";
import { STANDARD_ACTIONS } from "@/plugins/types";
import { runCommand } from "@/process";
import { executeSchemaGeneration } from "@/plugins/builtin/ecosystem/python/schema-codegen";

const WATCH_PATTERNS: readonly string[] = ["**/*.py", "pyproject.toml"];

/**
 * Resolve a Python tool binary, preferring per-package and workspace
 * venvs before falling back to PATH. Returns an absolute path when
 * found in a venv, or the bare name when PATH resolution should be used.
 *
 * Resolution order:
 *   1. <pkgDir>/.venv/bin/<name>   (per-package venv — most common)
 *   2. <pkgDir>/venv/bin/<name>    (alt convention)
 *   3. <root>/.venv/bin/<name>     (shared workspace venv)
 *   4. <name>                       (PATH fallback)
 */
export function resolvePythonTool(name: string, pkgDir: string, root: string): string {
  const candidates = [
    join(pkgDir, ".venv", "bin", name),
    join(pkgDir, "venv", "bin", name),
    join(root, ".venv", "bin", name),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return name;
}

/**
 * Check if a Python tool is available — either resolved from a venv or
 * present on PATH.
 */
async function hasPythonTool(name: string, pkgDir: string, root: string): Promise<boolean> {
  const resolved = resolvePythonTool(name, pkgDir, root);
  if (resolved !== name) {
    return true;
  }
  const result = await runCommand("which", [name], pkgDir);
  return result.success;
}

export const pythonPlugin: EcosystemPlugin = {
  type: "ecosystem",
  name: "python",
  manifest: "pyproject.toml",
  experimental: true,

  async detect(pkg: WorkspacePackage): Promise<boolean> {
    return pkg.ecosystem === "python";
  },

  async getWatchPatterns(): Promise<readonly string[]> {
    return WATCH_PATTERNS;
  },

  async getActions(pkg: WorkspacePackage, root: string): Promise<readonly string[]> {
    const pkgDir = join(root, pkg.path);
    const actions: string[] = [];

    if (await hasPythonTool("ruff", pkgDir, root)) {
      actions.push(STANDARD_ACTIONS.LINT, STANDARD_ACTIONS.LINT_FIX);
      actions.push(STANDARD_ACTIONS.FORMAT, STANDARD_ACTIONS.FORMAT_CHECK);
    }

    if (await hasPythonTool("pytest", pkgDir, root)) {
      actions.push(STANDARD_ACTIONS.TEST);
    }

    if (await hasPythonTool("mypy", pkgDir, root)) {
      actions.push(STANDARD_ACTIONS.TYPECHECK);
    } else if (await hasPythonTool("pyright", pkgDir, root)) {
      actions.push(STANDARD_ACTIONS.TYPECHECK);
    }

    return actions;
  },

  async execute(
    action: string,
    pkg: WorkspacePackage,
    root: string,
    context: ExecutionContext,
  ): Promise<ExecuteResult> {
    const pkgDir = join(root, pkg.path);
    const fmtPy = context.formatPython;
    const lintPy = context.lintPython;

    switch (action) {
      case STANDARD_ACTIONS.LINT: {
        const args = ["check"];
        if (lintPy?.select) {
          args.push("--select", lintPy.select.join(","));
        }
        if (lintPy?.ignore) {
          args.push("--ignore", lintPy.ignore.join(","));
        }
        if (lintPy?.targetVersion) {
          args.push("--target-version", lintPy.targetVersion);
        }
        args.push(".");
        return runCommand(resolvePythonTool("ruff", pkgDir, root), args, pkgDir);
      }

      case STANDARD_ACTIONS.LINT_FIX: {
        const args = ["check", "--fix"];
        if (lintPy?.fixable) {
          args.push("--fixable", lintPy.fixable.join(","));
        }
        args.push(".");
        return runCommand(resolvePythonTool("ruff", pkgDir, root), args, pkgDir);
      }

      case STANDARD_ACTIONS.FORMAT: {
        const args = ["format"];
        if (fmtPy?.lineLength) {
          args.push("--line-length", String(fmtPy.lineLength));
        }
        if (fmtPy?.quoteStyle) {
          args.push("--config", `quote-style="${fmtPy.quoteStyle}"`);
        }
        args.push(".");
        return runCommand(resolvePythonTool("ruff", pkgDir, root), args, pkgDir);
      }

      case STANDARD_ACTIONS.FORMAT_CHECK: {
        const args = ["format", "--check"];
        if (fmtPy?.lineLength) {
          args.push("--line-length", String(fmtPy.lineLength));
        }
        args.push(".");
        return runCommand(resolvePythonTool("ruff", pkgDir, root), args, pkgDir);
      }

      case STANDARD_ACTIONS.TEST:
        return runCommand(resolvePythonTool("pytest", pkgDir, root), [], pkgDir);

      case STANDARD_ACTIONS.TYPECHECK: {
        if (await hasPythonTool("mypy", pkgDir, root)) {
          return runCommand(resolvePythonTool("mypy", pkgDir, root), ["."], pkgDir);
        }
        return runCommand(resolvePythonTool("pyright", pkgDir, root), ["."], pkgDir);
      }

      case "generate-schema-python":
        return executeSchemaGeneration(pkg, root, context);

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
    _pkg: WorkspacePackage,
    _root: string,
  ): Promise<DomainCapability | null> {
    if (domain === "openapi") {
      return {
        action: "generate-openapi-python",
        description: "Generate Python OpenAPI client",
      };
    }
    if (domain === "design-tokens") {
      return {
        action: "generate-design-tokens-python",
        description: "Generate Python design token constants",
      };
    }
    if (domain === "schema") {
      return {
        action: "generate-schema-python",
        description: "Generate Python dataclasses from JSON Schema",
      };
    }
    return null;
  },
};
