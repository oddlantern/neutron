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
import { executeSchemaGeneration } from "@/plugins/builtin/ecosystem/php/schema-codegen";

const WATCH_PATTERNS: readonly string[] = [
  "src/**/*.php",
  "app/**/*.php",
  "tests/**/*.php",
  "composer.json",
];

/** Resolve a vendor binary, falling back to global PATH */
function resolveVendorBin(name: string, pkgDir: string): string {
  const vendorBin = join(pkgDir, "vendor", "bin", name);
  if (existsSync(vendorBin)) {
    return vendorBin;
  }
  return name;
}

export const phpPlugin: EcosystemPlugin = {
  type: "ecosystem",
  name: "php",
  manifest: "composer.json",

  async detect(pkg: WorkspacePackage): Promise<boolean> {
    return pkg.ecosystem === "php";
  },

  async getWatchPatterns(): Promise<readonly string[]> {
    return WATCH_PATTERNS;
  },

  async getActions(pkg: WorkspacePackage, root: string): Promise<readonly string[]> {
    const actions: string[] = [];
    const pkgDir = join(root, pkg.path);

    if (existsSync(join(pkgDir, "vendor", "bin", "phpstan")) || existsSync(join(pkgDir, "vendor", "bin", "psalm"))) {
      actions.push(STANDARD_ACTIONS.LINT);
    }

    if (existsSync(join(pkgDir, "vendor", "bin", "php-cs-fixer")) || existsSync(join(pkgDir, "vendor", "bin", "pint"))) {
      actions.push(STANDARD_ACTIONS.FORMAT, STANDARD_ACTIONS.FORMAT_CHECK);
    }

    if (existsSync(join(pkgDir, "vendor", "bin", "phpunit")) || existsSync(join(pkgDir, "vendor", "bin", "pest"))) {
      actions.push(STANDARD_ACTIONS.TEST);
    }

    return actions;
  },

  async execute(
    action: string,
    pkg: WorkspacePackage,
    root: string,
    _context: ExecutionContext,
  ): Promise<ExecuteResult> {
    const cwd = join(root, pkg.path);

    switch (action) {
      case STANDARD_ACTIONS.LINT: {
        const bin = existsSync(join(cwd, "vendor", "bin", "phpstan"))
          ? resolveVendorBin("phpstan", cwd)
          : resolveVendorBin("psalm", cwd);
        return runCommand(bin, ["analyse"], cwd);
      }

      case STANDARD_ACTIONS.FORMAT: {
        const bin = existsSync(join(cwd, "vendor", "bin", "php-cs-fixer"))
          ? resolveVendorBin("php-cs-fixer", cwd)
          : resolveVendorBin("pint", cwd);
        const args = bin.includes("php-cs-fixer") ? ["fix"] : [];
        return runCommand(bin, args, cwd);
      }

      case STANDARD_ACTIONS.FORMAT_CHECK: {
        const bin = existsSync(join(cwd, "vendor", "bin", "php-cs-fixer"))
          ? resolveVendorBin("php-cs-fixer", cwd)
          : resolveVendorBin("pint", cwd);
        const args = bin.includes("php-cs-fixer")
          ? ["fix", "--dry-run", "--diff"]
          : ["--test"];
        return runCommand(bin, args, cwd);
      }

      case STANDARD_ACTIONS.TEST: {
        const bin = existsSync(join(cwd, "vendor", "bin", "pest"))
          ? resolveVendorBin("pest", cwd)
          : resolveVendorBin("phpunit", cwd);
        return runCommand(bin, [], cwd);
      }

      case "generate-schema-php":
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
        action: "generate-openapi-php",
        description: "Generate PHP OpenAPI client",
      };
    }
    if (domain === "schema") {
      return {
        action: "generate-schema-php",
        description: "Generate PHP classes from JSON Schema",
      };
    }
    return null;
  },
};
