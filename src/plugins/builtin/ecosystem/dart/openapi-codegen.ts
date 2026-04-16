import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";
import { runCommand } from "@/plugins/builtin/shared/exec";

/**
 * Execute OpenAPI Dart client generation into outputDir.
 *
 * Scaffolds a dart package at outputDir with swagger_parser + build_runner,
 * creates a swagger_parser config pointing to the artifact, then runs both tools.
 */
export async function executeOpenAPIDartGeneration(
  _pkg: WorkspacePackage,
  root: string,
  context: ExecutionContext,
): Promise<ExecuteResult> {
  const start = performance.now();
  const outDir = context.outputDir;
  if (!outDir) {
    return { success: false, duration: 0, summary: "No outputDir provided" };
  }

  mkdirSync(outDir, { recursive: true });

  const workspace = context.graph.name.replace(/-/g, "_").replace(/@/g, "").replace(/\//g, "_");
  const rawSource = (context.sourceName ?? "generated").replace(/^@[^/]+\//, "");
  const source = rawSource.replace(/-/g, "_").replace(/@/g, "").replace(/\//g, "_");
  const packageName = workspace ? `${workspace}_${source}` : source;

  // Scaffold pubspec.yaml if first run
  if (!existsSync(join(outDir, "pubspec.yaml"))) {
    const libDir = join(outDir, "lib");
    mkdirSync(libDir, { recursive: true });

    const pubspec = [
      `name: ${packageName}`,
      "publish_to: none",
      "",
      "environment:",
      "  sdk: '>=3.0.0 <4.0.0'",
      "",
      "dependencies:",
      "  dio: ^5.9.0",
      "  retrofit: '^4.9.0'",
      "  freezed_annotation: ^3.1.0",
      "  json_annotation: '^4.11.0'",
      "",
      "dev_dependencies:",
      "  build_runner: '^2.4.0'",
      "  freezed: ^3.2.0",
      "  json_serializable: '^6.13.0'",
      "  retrofit_generator: '>=10.2.0'",
      "  swagger_parser: ^1.43.0",
      "",
    ];
    writeFileSync(join(outDir, "pubspec.yaml"), pubspec.join("\n"), "utf-8");

    // Create package barrel
    writeFileSync(join(libDir, `${packageName}.dart`), `library ${packageName};\n`, "utf-8");
  }

  // Write swagger_parser config pointing to the artifact
  const artifactPath = context.artifactPath;
  if (!artifactPath) {
    return {
      success: false,
      duration: 0,
      summary: "No artifact path provided for OpenAPI generation",
    };
  }

  const artifactAbsolute = join(root, artifactPath);
  const swaggerConfig = [
    "swagger_parser:",
    `  schema_path: ${artifactAbsolute}`,
    "  output_directory: lib/",
    "  language: dart",
    "  freezed: true",
    "",
  ];
  writeFileSync(join(outDir, "swagger_parser.yaml"), swaggerConfig.join("\n"), "utf-8");

  // Run dart pub get first (needed for swagger_parser + build_runner)
  const pubGetResult = await runCommand("dart", ["pub", "get"], outDir);
  if (!pubGetResult.success) {
    return {
      success: false,
      duration: Math.round(performance.now() - start),
      summary: `dart pub get failed in ${outDir}`,
      output: pubGetResult.output,
    };
  }

  // Run swagger_parser
  const swaggerResult = await runCommand("dart", ["run", "swagger_parser"], outDir);
  if (!swaggerResult.success) {
    return {
      success: false,
      duration: Math.round(performance.now() - start),
      summary: "swagger_parser failed",
      output: swaggerResult.output,
    };
  }

  // Run build_runner
  const buildResult = await runCommand(
    "dart",
    ["run", "build_runner", "build", "--delete-conflicting-outputs"],
    outDir,
  );

  const duration = Math.round(performance.now() - start);
  if (!buildResult.success) {
    return {
      success: false,
      duration,
      summary: "build_runner failed",
      output: buildResult.output,
    };
  }

  return {
    success: true,
    duration,
    summary: "Dart OpenAPI client generated",
  };
}
