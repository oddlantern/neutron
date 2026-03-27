import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import type { WorkspacePackage } from "../../graph/types.js";
import type { ExecuteResult, ExecutionContext } from "../types.js";
import type { ValidatedTokens } from "./design/types.js";
import { getScripts, isRecord, readPackageJson, runCommand } from "./exec.js";
import { generateCSS, generateTS } from "./typescript/token-codegen.js";

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

/**
 * Parse an openapi-typescript invocation from a package script to extract
 * the input artifact path and output path.
 *
 * Example script: "openapi-typescript ../openapi.prepared.json -o generated/api.d.ts"
 * Returns: { input: "../openapi.prepared.json", output: "generated/api.d.ts" }
 */
function parseOpenapiTsScript(
  scriptValue: string,
): { readonly input: string; readonly output: string } | null {
  // Match: openapi-typescript <input> [flags...] -o <output>
  // Allows arbitrary flags between input and -o (e.g., --enum, --path-params-as-types)
  const pattern = /openapi-typescript\s+(\S+).*?\s(?:-o|--output)\s+(\S+)/;
  const match = pattern.exec(scriptValue);
  if (!match) {
    return null;
  }
  const input = match[1];
  const output = match[2];
  if (!input || !output) {
    return null;
  }
  return { input, output };
}

/**
 * Detect the openapi-typescript output path from existing scripts.
 * Searches generate, openapi:generate, and other scripts for openapi-typescript usage.
 * Returns the output path if found in a script.
 */
function detectOutputFromScripts(scripts: Record<string, string>): string | null {
  // Check scripts in priority order
  const scriptNames = ["generate", "openapi:generate", "generate:ts", "codegen"];
  for (const name of scriptNames) {
    const script = scripts[name];
    if (!script) {
      continue;
    }
    const parsed = parseOpenapiTsScript(script);
    if (parsed) {
      return parsed.output;
    }
  }

  // Check all scripts
  for (const script of Object.values(scripts)) {
    const parsed = parseOpenapiTsScript(script);
    if (parsed) {
      return parsed.output;
    }
  }

  return null;
}

/** Well-known output paths for openapi-typescript, checked in order */
const WELL_KNOWN_OUTPUT_PATHS: readonly string[] = [
  "generated/api.d.ts",
  "src/generated/api.d.ts",
  "src/api.d.ts",
];

/**
 * Resolve the output path for openapi-typescript.
 * Priority: existing scripts → existing well-known files → default.
 */
function resolveOutputPath(
  pkg: WorkspacePackage,
  root: string,
  scripts: Record<string, string>,
): string {
  // 1. Parse from existing scripts
  const fromScript = detectOutputFromScripts(scripts);
  if (fromScript) {
    return fromScript;
  }

  // 2. Check well-known output locations
  const pkgDir = join(root, pkg.path);
  for (const candidate of WELL_KNOWN_OUTPUT_PATHS) {
    if (existsSync(join(pkgDir, candidate))) {
      return candidate;
    }
  }

  // 3. Default
  return "generated/api.d.ts";
}

/**
 * Execute design token CSS/TS generation for a TypeScript package.
 *
 * When context.outputDir is set (new convention), writes to that directory
 * (`<source>/generated/typescript/`). Falls back to `<consumer>/generated/`
 * for backwards compatibility.
 */
export async function executeDesignTokenGeneration(
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

  // Determine output directory
  const outDir = context.outputDir ?? join(root, pkg.path, "generated");
  mkdirSync(outDir, { recursive: true });

  // Scaffold package.json if first run
  if (!existsSync(join(outDir, "package.json"))) {
    const pkgName = pkg.name ? `${pkg.name}-design-tokens` : "design-tokens";
    const pkgJson = {
      name: pkgName,
      version: "0.0.0",
      private: true,
      main: "tokens.css",
      types: "tokens.ts",
    };
    writeFileSync(join(outDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
  }

  const cssContent = generateCSS(tokens);
  const tsContent = generateTS(tokens);

  writeFileSync(join(outDir, "tokens.css"), cssContent, "utf-8");
  writeFileSync(join(outDir, "tokens.ts"), tsContent, "utf-8");

  const duration = Math.round(performance.now() - start);
  return {
    success: true,
    duration,
    summary: "2 files written",
  };
}

/**
 * Execute OpenAPI TypeScript codegen for a package.
 *
 * When context.outputDir is set (new convention), generates into that directory.
 * Falls back to generating inside the consumer package.
 */
export async function executeOpenAPICodegen(
  pkg: WorkspacePackage,
  root: string,
  context: ExecutionContext,
): Promise<ExecuteResult> {
  const pm = context.packageManager;

  let scripts: Record<string, string> = {};
  try {
    const manifest = await readPackageJson(pkg.path, root);
    scripts = getScripts(manifest);
  } catch {
    // manifest unreadable — proceed with empty scripts
  }

  // Resolve artifact input path
  const artifactPath = context.artifactPath;
  if (!artifactPath) {
    // No artifact path from domain plugin — fall back to generate script
    const cwd = join(root, pkg.path);
    if (scripts["generate"]) {
      return runCommand(pm, ["run", "generate"], cwd);
    }
    return {
      success: false,
      duration: 0,
      summary: `No artifact path provided and no generate script found in ${pkg.path}`,
    };
  }

  // Determine output location
  if (context.outputDir) {
    mkdirSync(context.outputDir, { recursive: true });
    const artifactRelative = relative(context.outputDir, join(root, artifactPath));
    const outputPath = "api.d.ts";
    const runner = pm === "bun" ? "bunx" : "npx";
    return runCommand(
      runner,
      ["openapi-typescript", artifactRelative, "-o", outputPath],
      context.outputDir,
    );
  }

  // Legacy: generate into consumer package
  const cwd = join(root, pkg.path);
  const artifactRelative = relative(cwd, join(root, artifactPath));
  const outputPath = resolveOutputPath(pkg, root, scripts);
  const runner = pm === "bun" ? "bunx" : "npx";

  return runCommand(runner, ["openapi-typescript", artifactRelative, "-o", outputPath], cwd);
}
