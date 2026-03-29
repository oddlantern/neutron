import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import type { WorkspacePackage } from "@/graph/types";
import { RED, RESET, YELLOW } from "@/output";
import type {
  DomainPlugin,
  ExecutablePipelineStep,
  ExecuteResult,
  ExecutionContext,
} from "@/plugins/types";
import { validateTokens } from "@/plugins/builtin/domain/design/token-schema";
import type { TokenValidationError, TokenValidationWarning } from "@/plugins/builtin/domain/design/token-schema";
import type { ValidatedTokens } from "@/plugins/builtin/domain/design/types";

const DOMAIN_NAME = "design-tokens";

/**
 * Format validation errors for terminal output.
 */
function formatValidationErrors(
  errors: readonly TokenValidationError[],
  warnings: readonly TokenValidationWarning[],
): string {
  const lines: string[] = [];
  lines.push(`${RED}✗ tokens.json validation failed${RESET}`);

  for (const err of errors) {
    lines.push(`  ${RED}${err.path}: ${err.message}${RESET}`);
  }

  for (const warn of warnings) {
    lines.push(`  ${YELLOW}${warn.path}: ${warn.message}${RESET}`);
  }

  return lines.join("\n");
}

/**
 * Read and parse a token artifact file (JSON or YAML).
 */
async function readAndParseArtifact(artifactPath: string, root: string): Promise<unknown> {
  const absPath = join(root, artifactPath);
  const content = await readFile(absPath, "utf-8");
  const ext = artifactPath.split(".").pop()?.toLowerCase();
  if (ext === "yaml" || ext === "yml") {
    const parsed: unknown = parseYaml(content);
    return parsed;
  }
  const parsed: unknown = JSON.parse(content);
  return parsed;
}

/**
 * Check if a parsed JSON object looks like a design tokens file.
 * Must have a `color` key at the top level.
 */
function looksLikeTokens(raw: unknown): boolean {
  if (typeof raw !== "object" || !raw) {
    return false;
  }
  return "color" in raw;
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export const designPlugin: DomainPlugin = {
  type: "domain",
  name: "design",

  async detectBridge(artifact: string, root: string): Promise<boolean> {
    const ext = artifact.split(".").pop()?.toLowerCase();
    if (!ext || !["json", "yaml", "yml"].includes(ext)) {
      return false;
    }

    try {
      const raw = await readAndParseArtifact(artifact, root);
      return looksLikeTokens(raw);
    } catch {
      return false;
    }
  },

  async exportArtifact(
    _source: WorkspacePackage,
    artifact: string,
    root: string,
  ): Promise<ExecuteResult> {
    const start = performance.now();

    try {
      const raw = await readAndParseArtifact(artifact, root);
      const result = validateTokens(raw);

      if (!result.success) {
        const output = formatValidationErrors(result.errors, result.warnings);
        return {
          success: false,
          duration: Math.round(performance.now() - start),
          summary: `tokens.json validation failed (${result.errors.length} error(s))`,
          output,
        };
      }

      return {
        success: true,
        duration: Math.round(performance.now() - start),
        summary: "tokens valid",
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        duration: Math.round(performance.now() - start),
        summary: `Failed to read tokens.json: ${msg}`,
      };
    }
  },

  async generateDownstream(
    artifact: string,
    targets: readonly WorkspacePackage[],
    root: string,
    context: ExecutionContext,
  ): Promise<readonly ExecuteResult[]> {
    const raw = await readAndParseArtifact(artifact, root);
    const validation = validateTokens(raw);
    if (!validation.success || !validation.data) {
      return [
        {
          success: false,
          duration: 0,
          summary: "tokens.json validation failed — cannot generate downstream",
        },
      ];
    }

    const handlers = await context.findEcosystemHandlers(DOMAIN_NAME, artifact);
    const targetPaths = new Set(targets.map((t) => t.path));
    const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));

    if (relevantHandlers.length === 0) {
      return [];
    }

    // Derive source path and name from artifact (artifact lives in source package)
    const sourcePath = artifact.split("/").slice(0, -1).join("/") || ".";
    const sourcePkg = context.graph.packages.get(sourcePath);
    const sourceName = sourcePkg?.name ?? sourcePath.split("/").pop() ?? "generated";

    const results: ExecuteResult[] = [];
    for (const handler of relevantHandlers) {
      const outputDir = join(root, sourcePath, "generated", handler.plugin.name);
      mkdirSync(outputDir, { recursive: true });

      const ctxWithTokens: ExecutionContext = {
        ...context,
        sourceName,
        artifactPath: artifact,
        domainData: validation.data,
        outputDir,
      };

      const result = await handler.plugin.execute(
        handler.capability.action,
        handler.pkg,
        root,
        ctxWithTokens,
      );
      results.push(result);
    }

    return results;
  },

  async buildPipeline(
    _source: WorkspacePackage,
    artifact: string,
    targets: readonly WorkspacePackage[],
    root: string,
    context: ExecutionContext,
  ): Promise<readonly ExecutablePipelineStep[]> {
    const steps: ExecutablePipelineStep[] = [];

    // Mutable ref shared between the validate step closure and generation closures.
    // The validate step writes to this; generation steps read from it.
    const shared: { data: ValidatedTokens | undefined } = { data: undefined };

    // Step 1: Validate tokens
    steps.push({
      name: "validate-tokens",
      plugin: "design",
      description: "validating tokens...",
      outputPaths: [artifact],
      execute: async (): Promise<ExecuteResult> => {
        const start = performance.now();
        try {
          const raw = await readAndParseArtifact(artifact, root);
          const result = validateTokens(raw);

          if (!result.success) {
            const output = formatValidationErrors(result.errors, result.warnings);
            return {
              success: false,
              duration: Math.round(performance.now() - start),
              summary: "tokens.json validation failed",
              output,
            };
          }

          shared.data = result.data;
          return {
            success: true,
            duration: Math.round(performance.now() - start),
            summary: "tokens valid",
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            duration: Math.round(performance.now() - start),
            summary: `Failed to read tokens.json: ${msg}`,
          };
        }
      },
    });

    // Discover ecosystem handlers — one per unique ecosystem among targets
    const handlers = await context.findEcosystemHandlers(DOMAIN_NAME, artifact);
    const targetPaths = new Set(targets.map((t) => t.path));
    const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));

    // Deduplicate by ecosystem
    const seenEcosystems = new Set<string>();
    for (const handler of relevantHandlers) {
      if (seenEcosystems.has(handler.plugin.name)) {
        continue;
      }
      seenEcosystems.add(handler.plugin.name);
      const outputDir = join(root, _source.path, "generated", handler.plugin.name);

      steps.push({
        name: `generate-${handler.plugin.name}`,
        plugin: handler.plugin.name,
        description: `${handler.capability.description}...`,
        execute: async (): Promise<ExecuteResult> => {
          if (!shared.data) {
            return {
              success: false,
              duration: 0,
              summary: "Cannot generate — token validation did not run",
            };
          }

          mkdirSync(outputDir, { recursive: true });

          const ctxWithTokens: ExecutionContext = {
            ...context,
            sourceName: _source.name,
            artifactPath: artifact,
            domainData: shared.data,
            outputDir,
          };

          return handler.plugin.execute(
            handler.capability.action,
            handler.pkg,
            root,
            ctxWithTokens,
          );
        },
      });
    }

    return steps;
  },
};
