import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";
import { resolvePythonTool } from "@/plugins/builtin/ecosystem/python/plugin";
import { runCommand } from "@/process";

const GENERATOR_TOOL = "openapi-python-client";

/**
 * Generate a Python OpenAPI client from a validated spec.
 *
 * Invokes openapi-python-client (pydantic v2 output). The tool produces
 * a full package with async/sync clients, pydantic models, and api/
 * modules organized per tag. We regenerate in-place (`--overwrite`) so
 * stale files from prior runs are cleared.
 *
 * The source of truth for the spec is the bridge artifact — resolved
 * via context.artifactPath. Output goes to context.outputDir which the
 * domain plugin has set to `<source>/generated/python/`.
 */
export async function executeOpenapiClientGeneration(
  _pkg: WorkspacePackage,
  root: string,
  context: ExecutionContext,
): Promise<ExecuteResult> {
  const start = performance.now();

  const artifactPath = context.artifactPath;
  if (!artifactPath) {
    return {
      success: false,
      duration: 0,
      summary: "No artifactPath set — openapi domain must run before codegen",
    };
  }

  const outDir = context.outputDir;
  if (!outDir) {
    return {
      success: false,
      duration: 0,
      summary: "No outputDir provided",
    };
  }

  mkdirSync(outDir, { recursive: true });

  // openapi-python-client reads the spec from a file path. It needs the
  // absolute path because we're running the tool from outDir — cwd-relative
  // would break as soon as the output and artifact live in different trees.
  const specPath = resolve(root, artifactPath);
  if (!existsSync(specPath)) {
    return {
      success: false,
      duration: Math.round(performance.now() - start),
      summary: `Spec file not found: ${artifactPath}`,
    };
  }

  const tool = resolvePythonTool(GENERATOR_TOOL, outDir, root);
  const result = await runCommand(
    tool,
    ["generate", "--path", specPath, "--output-path", outDir, "--overwrite"],
    outDir,
  );

  if (!result.success) {
    const hint =
      tool === GENERATOR_TOOL
        ? ` Install with \`pip install openapi-python-client\` or \`uv tool install openapi-python-client\`.`
        : "";
    return {
      success: false,
      duration: Math.round(performance.now() - start),
      summary: `openapi-python-client failed.${hint}`,
      output: result.output,
    };
  }

  // Scaffold a minimal pyproject.toml if the generator didn't produce one
  // (older versions of openapi-python-client just emit the client module
  // without a package manifest). Makes the output directly importable as
  // a workspace package without further setup.
  const generatedPyproject = join(outDir, "pyproject.toml");
  if (!existsSync(generatedPyproject)) {
    const workspace = context.graph.name;
    const sourceName = context.sourceName ?? "client";
    const pkgName = workspace ? `${workspace}_${sourceName}` : sourceName;
    writeFileSync(
      generatedPyproject,
      [
        "[project]",
        `name = "${pkgName}"`,
        'version = "0.0.0"',
        'description = "Generated — do not edit"',
        "dependencies = [",
        '    "httpx >= 0.24.0",',
        '    "pydantic >= 2.0.0",',
        "]",
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  return {
    success: true,
    duration: Math.round(performance.now() - start),
    summary: `Python OpenAPI client generated in ${outDir}`,
  };
}
