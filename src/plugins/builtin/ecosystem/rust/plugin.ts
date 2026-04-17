import type { WorkspacePackage } from "@/graph/types";
import type {
  DomainCapability,
  EcosystemPlugin,
  ExecuteResult,
  ExecutionContext,
} from "@/plugins/types";
import { STANDARD_ACTIONS } from "@/plugins/types";
import { runCommand } from "@/process";
import { executeSchemaGeneration } from "@/plugins/builtin/ecosystem/rust/schema-codegen";

const WATCH_PATTERNS: readonly string[] = ["src/**/*.rs", "Cargo.toml"];

export const rustPlugin: EcosystemPlugin = {
  type: "ecosystem",
  name: "rust",
  manifest: "Cargo.toml",
  experimental: true,

  async detect(pkg: WorkspacePackage): Promise<boolean> {
    return pkg.ecosystem === "rust";
  },

  async getWatchPatterns(): Promise<readonly string[]> {
    return WATCH_PATTERNS;
  },

  async getActions(): Promise<readonly string[]> {
    // Cargo is assumed to be available if Rust packages are in the workspace
    return [
      STANDARD_ACTIONS.LINT,
      STANDARD_ACTIONS.FORMAT,
      STANDARD_ACTIONS.FORMAT_CHECK,
      STANDARD_ACTIONS.TEST,
      STANDARD_ACTIONS.BUILD,
    ];
  },

  async execute(
    action: string,
    pkg: WorkspacePackage,
    root: string,
    _context: ExecutionContext,
  ): Promise<ExecuteResult> {
    const cwd = `${root}/${pkg.path}`;
    const lintRs = _context.lintRust;

    switch (action) {
      case STANDARD_ACTIONS.LINT: {
        const args = ["clippy"];
        if (lintRs?.features) {
          args.push("--features", lintRs.features.join(","));
        }
        args.push("--");
        if (lintRs?.denyWarnings !== false) {
          args.push("-D", "warnings");
        }
        return runCommand("cargo", args, cwd);
      }

      case STANDARD_ACTIONS.LINT_FIX:
        return runCommand("cargo", ["clippy", "--fix", "--allow-dirty", "--allow-staged"], cwd);

      case STANDARD_ACTIONS.FORMAT:
        return runCommand("cargo", ["fmt"], cwd);

      case STANDARD_ACTIONS.FORMAT_CHECK:
        return runCommand("cargo", ["fmt", "--check"], cwd);

      case STANDARD_ACTIONS.TEST:
        return runCommand("cargo", ["test"], cwd);

      case STANDARD_ACTIONS.BUILD:
        return runCommand("cargo", ["build"], cwd);

      case "generate-schema-rust":
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
        action: "generate-openapi-rust",
        description: "Generate Rust OpenAPI client",
      };
    }
    if (domain === "schema") {
      return {
        action: "generate-schema-rust",
        description: "Generate Rust structs from JSON Schema",
      };
    }
    return null;
  },
};
