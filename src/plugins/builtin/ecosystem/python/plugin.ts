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

/** Check if a tool is available on PATH */
async function hasTool(name: string, cwd: string): Promise<boolean> {
  const result = await runCommand("which", [name], cwd);
  return result.success;
}

export const pythonPlugin: EcosystemPlugin = {
  type: "ecosystem",
  name: "python",
  manifest: "pyproject.toml",

  async detect(pkg: WorkspacePackage): Promise<boolean> {
    return pkg.ecosystem === "python";
  },

  async getWatchPatterns(): Promise<readonly string[]> {
    return WATCH_PATTERNS;
  },

  async getActions(_pkg: WorkspacePackage, root: string): Promise<readonly string[]> {
    const actions: string[] = [];
    const cwd = root;

    if (await hasTool("ruff", cwd)) {
      actions.push(STANDARD_ACTIONS.LINT, STANDARD_ACTIONS.LINT_FIX);
      actions.push(STANDARD_ACTIONS.FORMAT, STANDARD_ACTIONS.FORMAT_CHECK);
    }

    if (await hasTool("pytest", cwd)) {
      actions.push(STANDARD_ACTIONS.TEST);
    }

    if (await hasTool("mypy", cwd)) {
      actions.push(STANDARD_ACTIONS.TYPECHECK);
    } else if (await hasTool("pyright", cwd)) {
      actions.push(STANDARD_ACTIONS.TYPECHECK);
    }

    return actions;
  },

  async execute(
    action: string,
    pkg: WorkspacePackage,
    root: string,
    _context: ExecutionContext,
  ): Promise<ExecuteResult> {
    const cwd = `${root}/${pkg.path}`;
    const fmtPy = _context.formatPython;
    const lintPy = _context.lintPython;

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
        return runCommand("ruff", args, cwd);
      }

      case STANDARD_ACTIONS.LINT_FIX: {
        const args = ["check", "--fix"];
        if (lintPy?.fixable) {
          args.push("--fixable", lintPy.fixable.join(","));
        }
        args.push(".");
        return runCommand("ruff", args, cwd);
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
        return runCommand("ruff", args, cwd);
      }

      case STANDARD_ACTIONS.FORMAT_CHECK: {
        const args = ["format", "--check"];
        if (fmtPy?.lineLength) {
          args.push("--line-length", String(fmtPy.lineLength));
        }
        args.push(".");
        return runCommand("ruff", args, cwd);
      }

      case STANDARD_ACTIONS.TEST:
        return runCommand("pytest", [], cwd);

      case STANDARD_ACTIONS.TYPECHECK: {
        if (await hasTool("mypy", root)) {
          return runCommand("mypy", ["."], cwd);
        }
        return runCommand("pyright", ["."], cwd);
      }

      case "generate-schema-python":
        return executeSchemaGeneration(pkg, root, _context);

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
