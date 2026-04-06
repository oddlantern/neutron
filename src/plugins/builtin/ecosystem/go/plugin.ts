import type { WorkspacePackage } from "@/graph/types";
import type {
  DomainCapability,
  EcosystemPlugin,
  ExecuteResult,
  ExecutionContext,
} from "@/plugins/types";
import { STANDARD_ACTIONS } from "@/plugins/types";
import { runCommand } from "@/process";
import { executeSchemaGeneration } from "@/plugins/builtin/ecosystem/go/schema-codegen";

const WATCH_PATTERNS: readonly string[] = ["**/*.go", "go.mod", "go.sum"];

/** Check if a tool is available on PATH */
async function hasTool(name: string, cwd: string): Promise<boolean> {
  const result = await runCommand("which", [name], cwd);
  return result.success;
}

export const goPlugin: EcosystemPlugin = {
  type: "ecosystem",
  name: "go",
  manifest: "go.mod",

  async detect(pkg: WorkspacePackage): Promise<boolean> {
    return pkg.ecosystem === "go";
  },

  async getWatchPatterns(): Promise<readonly string[]> {
    return WATCH_PATTERNS;
  },

  async getActions(_pkg: WorkspacePackage, root: string): Promise<readonly string[]> {
    const actions: string[] = [
      STANDARD_ACTIONS.FORMAT,
      STANDARD_ACTIONS.FORMAT_CHECK,
      STANDARD_ACTIONS.TEST,
      STANDARD_ACTIONS.BUILD,
      STANDARD_ACTIONS.TYPECHECK,
    ];

    if (await hasTool("golangci-lint", root)) {
      actions.push(STANDARD_ACTIONS.LINT);
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

    switch (action) {
      case STANDARD_ACTIONS.LINT:
        return runCommand("golangci-lint", ["run"], cwd);

      case STANDARD_ACTIONS.FORMAT:
        return runCommand("gofmt", ["-w", "."], cwd);

      case STANDARD_ACTIONS.FORMAT_CHECK: {
        // gofmt -l lists files that need formatting; non-empty output = unformatted
        const result = await runCommand("gofmt", ["-l", "."], cwd);
        if (result.success && result.output?.trim()) {
          return {
            success: false,
            duration: result.duration,
            summary: "Unformatted files found",
            output: result.output,
          };
        }
        return result;
      }

      case STANDARD_ACTIONS.TEST:
        return runCommand("go", ["test", "./..."], cwd);

      case STANDARD_ACTIONS.BUILD:
        return runCommand("go", ["build", "./..."], cwd);

      case STANDARD_ACTIONS.TYPECHECK:
        return runCommand("go", ["vet", "./..."], cwd);

      case "generate-schema-go":
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
        action: "generate-openapi-go",
        description: "Generate Go OpenAPI client",
      };
    }
    if (domain === "schema") {
      return {
        action: "generate-schema-go",
        description: "Generate Go structs from JSON Schema",
      };
    }
    return null;
  },
};
