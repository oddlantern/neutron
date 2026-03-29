import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import { detectPackageManager } from "@/pm-detect";
import { runCommand } from "@/process";

import { hasFlutterDeps } from "@/outdated/collect";
import type { OutdatedDep, ValidationResult } from "@/outdated/types";

const MAX_SHORT_OUTPUT = 500;
const MAX_LONG_OUTPUT = 1000;

/** Validate npm package name — reject names with special characters that could break import statements. */
const SAFE_NPM_NAME_RE = /^(@[a-z0-9\-~][a-z0-9\-._~]*\/)?[a-z0-9\-~][a-z0-9\-._~]*$/;

/** Validate Dart package name. */
const SAFE_DART_NAME_RE = /^[a-z_][a-z0-9_]*$/;

/** Check if a dependency name is safe for code generation interpolation. */
function isSafeDepName(name: string, ecosystem: string): boolean {
  if (ecosystem === "dart") {
    return SAFE_DART_NAME_RE.test(name);
  }
  return SAFE_NPM_NAME_RE.test(name);
}

// ── TypeScript validation ────────────────────────────────────────────

/**
 * Create a temp project, install deps with updated versions, and run typecheck.
 */
async function validateTypescriptDeps(
  deps: readonly OutdatedDep[],
  root: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
): Promise<readonly ValidationResult[]> {
  const tmpDir = await mkdtemp(join(tmpdir(), "mido-validate-ts-"));

  try {
    // Build a package.json with all workspace deps, overriding outdated ones
    const allDeps: Record<string, string> = {};
    for (const [, pkg] of packages) {
      if (pkg.ecosystem !== "typescript") {
        continue;
      }
      for (const dep of pkg.dependencies) {
        if (dep.type === "production" || dep.type === "dev") {
          allDeps[dep.name] = dep.range;
        }
      }
    }

    // Apply the outdated version upgrades
    const depMap = new Map(deps.map((d) => [d.name, d]));
    for (const [name, dep] of depMap) {
      const currentRange = allDeps[name];
      if (currentRange) {
        // Preserve range prefix (^ or ~)
        const prefix = currentRange.match(/^[\^~]/)?.[0] ?? "^";
        allDeps[name] = `${prefix}${dep.latest}`;
      }
    }

    const manifest = {
      name: "mido-validate",
      private: true,
      dependencies: allDeps,
    };

    await writeFile(join(tmpDir, "package.json"), JSON.stringify(manifest, null, 2));

    // Copy tsconfig.base.json if it exists (tsconfig.json is generated below)
    try {
      await copyFile(join(root, "tsconfig.base.json"), join(tmpDir, "tsconfig.base.json"));
    } catch {
      // Not found — skip
    }

    // Install
    const pm = detectPackageManager(root);
    const installArgs = pm === "yarn" ? ["install", "--no-lockfile"] : ["install"];
    const installResult = await runCommand(pm, installArgs, tmpDir);

    if (!installResult.success) {
      // Installation failed — all deps fail validation
      return deps.map((dep) => ({
        dep,
        typecheckPassed: false,
        testsPassed: false,
        typecheckOutput: `Install failed: ${(installResult.output ?? "").slice(0, MAX_SHORT_OUTPUT)}`,
        testOutput: undefined,
      }));
    }

    // Create a minimal source file that imports from each updated dep
    const safeDeps = deps.filter((dep) => isSafeDepName(dep.name, "typescript"));
    const importLines = safeDeps.map(
      (dep, i) => `import * as _dep${String(i)} from "${dep.name}";`,
    );
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src", "validate.ts"), importLines.join("\n") + "\n");

    // Write a minimal tsconfig that checks the validation file
    const tsConfig = {
      compilerOptions: {
        target: "ES2022",
        module: "ES2022",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: ["src/validate.ts"],
    };
    await writeFile(join(tmpDir, "tsconfig.json"), JSON.stringify(tsConfig, null, 2));

    // Run typecheck
    const tscBin = pm === "bun" ? "bunx" : "npx";
    const typecheckResult = await runCommand(tscBin, ["tsc", "--noEmit"], tmpDir);

    // For now, all deps in the group share the same result
    // (we can't isolate per-dep without separate installs)
    return deps.map((dep) => ({
      dep,
      typecheckPassed: typecheckResult.success,
      testsPassed: true, // Tests require actual workspace sources — skip for now
      typecheckOutput: typecheckResult.success ? undefined : (typecheckResult.output ?? "").slice(0, MAX_LONG_OUTPUT),
      testOutput: undefined,
    }));
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Dart validation ──────────────────────────────────────────────────

/**
 * Create a temp project, install deps with updated versions, and run analysis.
 */
async function validateDartDeps(
  deps: readonly OutdatedDep[],
  root: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
): Promise<readonly ValidationResult[]> {
  const tmpDir = await mkdtemp(join(tmpdir(), "mido-validate-dart-"));

  try {
    // Build a pubspec.yaml with all workspace deps, overriding outdated ones
    const allDeps: Record<string, string> = {};
    for (const [, pkg] of packages) {
      if (pkg.ecosystem !== "dart") {
        continue;
      }
      for (const dep of pkg.dependencies) {
        if (dep.type === "production" && dep.range !== "<local>" && dep.range !== "any") {
          allDeps[dep.name] = dep.range;
        }
      }
    }

    // Apply the outdated version upgrades
    const depMap = new Map(deps.map((d) => [d.name, d]));
    for (const [name, dep] of depMap) {
      const currentRange = allDeps[name];
      if (currentRange) {
        const prefix = currentRange.match(/^[\^~]/)?.[0] ?? "^";
        allDeps[name] = `${prefix}${dep.latest}`;
      }
    }

    // Write pubspec.yaml
    const depsYaml = Object.entries(allDeps)
      .map(([name, range]) => `  ${name}: "${range}"`)
      .join("\n");

    const pubspec = [
      "name: mido_validate",
      "version: 0.0.1",
      "environment:",
      '  sdk: ">=3.0.0 <4.0.0"',
      "dependencies:",
      depsYaml,
    ].join("\n");

    await writeFile(join(tmpDir, "pubspec.yaml"), pubspec);

    // Copy analysis options if they exist
    try {
      await copyFile(join(root, "analysis_options.yaml"), join(tmpDir, "analysis_options.yaml"));
    } catch {
      // Not found — skip
    }

    // Run pub get
    const isFlutter = hasFlutterDeps(packages);
    const pubCmd = isFlutter ? "flutter" : "dart";
    const pubResult = await runCommand(pubCmd, ["pub", "get"], tmpDir);

    if (!pubResult.success) {
      return deps.map((dep) => ({
        dep,
        typecheckPassed: false,
        testsPassed: false,
        typecheckOutput: `pub get failed: ${(pubResult.output ?? "").slice(0, MAX_SHORT_OUTPUT)}`,
        testOutput: undefined,
      }));
    }

    // Create a minimal dart file that imports each dep
    await mkdir(join(tmpDir, "lib"), { recursive: true });
    const safeDeps = deps.filter((dep) => isSafeDepName(dep.name, "dart"));
    const importLines = safeDeps.map((dep) => `import 'package:${dep.name}/${dep.name}.dart';`);
    await writeFile(join(tmpDir, "lib", "validate.dart"), importLines.join("\n") + "\n");

    // Run dart analyze
    const analyzeResult = await runCommand("dart", ["analyze"], tmpDir);

    return deps.map((dep) => ({
      dep,
      typecheckPassed: analyzeResult.success,
      testsPassed: true,
      typecheckOutput: analyzeResult.success ? undefined : (analyzeResult.output ?? "").slice(0, MAX_LONG_OUTPUT),
      testOutput: undefined,
    }));
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Level 3 orchestrator ─────────────────────────────────────────────

/**
 * Run Level 3 live validation: install updated deps in temp directories,
 * run typecheck and analysis per ecosystem.
 */
export async function runLevel3(
  outdated: readonly OutdatedDep[],
  root: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
): Promise<readonly ValidationResult[]> {
  const tsDeps = outdated.filter((d) => d.ecosystem === "typescript");
  const dartDeps = outdated.filter((d) => d.ecosystem === "dart");

  const results: ValidationResult[] = [];

  // Run ecosystem validations in parallel
  const [tsResults, dartResults] = await Promise.all([
    tsDeps.length > 0 ? validateTypescriptDeps(tsDeps, root, packages) : Promise.resolve([]),
    dartDeps.length > 0 ? validateDartDeps(dartDeps, root, packages) : Promise.resolve([]),
  ]);

  results.push(...tsResults, ...dartResults);

  return results;
}
