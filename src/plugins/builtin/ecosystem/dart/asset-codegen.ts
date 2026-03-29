import { existsSync, mkdirSync, readdirSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";
import { isRecord } from "@/plugins/builtin/shared/exec";
import type { AssetCategory, AssetManifest, ThemeVariant } from "@/plugins/builtin/domain/assets/types";

const HEADER = "// GENERATED — DO NOT EDIT. Changes will be overwritten.";

/**
 * Convert a category name to PascalCase for class naming.
 * e.g., "map_pins" → "MapPins", "ui" → "Ui"
 */
function toPascalCase(str: string): string {
  return str
    .split(/[_\-/]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Convert a key to a valid Dart identifier (camelCase).
 * e.g., "first_walk" → "firstWalk", "wren-head" → "wrenHead"
 * Keys starting with a digit get a `$` prefix.
 */
function toCamelCase(str: string): string {
  const parts = str.split(/[_\-]/).filter((p) => p.length > 0);
  if (parts.length === 0) {
    return str;
  }
  const first = parts[0] ?? "";
  const rest = parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  const result = first + rest.join("");
  // Dart identifiers cannot start with a digit
  if (/^\d/.test(result)) {
    return `\$${result}`;
  }
  return result;
}

/**
 * Generate a prefixed class name from workspace name.
 * Splits on delimiters or camelCase boundaries.
 * e.g., "nextsaga" → "Ns", "my-app" → "Ma", "coolProject" → "Cp"
 */
function derivePrefix(workspaceName: string): string {
  // Split on explicit delimiters first
  const explicitParts = workspaceName.split(/[_\-.\s]+/);
  if (explicitParts.length >= 2) {
    return explicitParts.map((p) => p.charAt(0).toUpperCase()).join("");
  }

  // Try splitting on camelCase boundaries (e.g., "nextSaga" → ["next", "Saga"])
  const camelParts = workspaceName.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
  if (camelParts.length >= 2) {
    return camelParts.map((p) => p.charAt(0).toUpperCase()).join("");
  }

  // Try splitting long single words at common word boundaries
  // Match known patterns: consonant clusters after vowel groups
  const word = workspaceName.toLowerCase();
  if (word.length >= 6) {
    // Try midpoint split — first letter + letter at ~halfway
    const mid = Math.floor(word.length / 2);
    return word.charAt(0).toUpperCase() + word.charAt(mid).toUpperCase();
  }

  // Short single word — first 2 chars
  return word.charAt(0).toUpperCase() + (word.charAt(1) ?? "").toUpperCase();
}

/**
 * Generate a typed Dart widget class for a category of SVG icons.
 */
function generateCategoryClass(
  category: AssetCategory,
  prefix: string,
  packageName: string,
): string | null {
  const svgEntries = category.entries.filter((e) => e.ext === "svg");
  if (svgEntries.length === 0) {
    return null;
  }

  const className = `${prefix}${toPascalCase(category.name)}Icon`;
  const lines: string[] = [];

  lines.push(`abstract final class ${className} {`);

  for (const entry of svgEntries) {
    const methodName = toCamelCase(entry.key);
    lines.push(`  static Widget ${methodName}({double? size, Color? color}) =>`);
    lines.push("    SvgPicture.asset(");
    lines.push(`      'assets/${entry.relativePath}',`);
    lines.push(`      package: '${packageName}',`);
    lines.push("      width: size,");
    lines.push("      height: size,");
    lines.push("      colorFilter: color != null");
    lines.push("        ? ColorFilter.mode(color, BlendMode.srcIn)");
    lines.push("        : null,");
    lines.push("    );");
    lines.push("");
  }

  // Dynamic accessor for the entire category
  const firstEntry = svgEntries[0];
  if (firstEntry) {
    const pathParts = firstEntry.relativePath.split("/");
    const dir = pathParts.slice(0, -1).join("/");
    const hasCommonDir = svgEntries.every((e) => e.relativePath.startsWith(dir + "/"));

    if (hasCommonDir) {
      lines.push(`  /// Dynamic accessor — loads by key from the ${category.name} directory.`);
      lines.push("  static Widget byKey(String key, {double? size, Color? color}) =>");
      lines.push("    SvgPicture.asset(");
      lines.push(`      'assets/$dir/${category.name}_\$key.svg',`);
      lines.push(`      package: '${packageName}',`);
      lines.push("      width: size,");
      lines.push("      height: size,");
      lines.push("      colorFilter: color != null");
      lines.push("        ? ColorFilter.mode(color, BlendMode.srcIn)");
      lines.push("        : null,");
      lines.push("    );");
    }
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Generate theme-aware icon classes for variant groups (light/dark).
 */
function generateThemeVariantClass(
  variant: ThemeVariant,
  prefix: string,
  packageName: string,
): string {
  const className = `${prefix}${toPascalCase(variant.category)}Icon`;
  const lines: string[] = [];

  lines.push(`abstract final class ${className} {`);

  // Collect all unique keys across variants, sorted for stable output
  const allKeys = new Set<string>();
  for (const [, entries] of variant.variants) {
    for (const entry of entries) {
      allKeys.add(entry.key);
    }
  }

  const sortedKeys = [...allKeys].sort();
  for (const key of sortedKeys) {
    const methodName = toCamelCase(key);
    lines.push(`  static Widget ${methodName}({required bool isDark, double? size, Color? color}) {`);
    lines.push("    final variant = isDark ? 'dark' : 'light';");

    const firstVariant = [...variant.variants.values()][0];
    const entry = firstVariant?.find((e) => e.key === key);
    if (entry) {
      const pathParts = entry.relativePath.split("/");
      const variantIdx = pathParts.findIndex((p) => p === "light" || p === "dark");
      if (variantIdx >= 0) {
        pathParts[variantIdx] = "\$variant";
        const templatePath = pathParts.join("/");
        lines.push("    return SvgPicture.asset(");
        lines.push(`      'assets/${templatePath}',`);
        lines.push(`      package: '${packageName}',`);
        lines.push("      width: size,");
        lines.push("      height: size,");
        lines.push("      colorFilter: color != null");
        lines.push("        ? ColorFilter.mode(color, BlendMode.srcIn)");
        lines.push("        : null,");
        lines.push("    );");
      }
    }
    lines.push("  }");
    lines.push("");
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Generate the pubspec.yaml for the generated Dart assets package.
 */
function generatePubspec(
  packageName: string,
  assetDirs: readonly string[],
): string {
  const lines: string[] = [
    "# GENERATED — DO NOT EDIT. Changes will be overwritten.",
    `name: ${packageName}`,
    `description: Generated asset package for ${packageName}`,
    "version: 0.0.0",
    "publish_to: none",
    "",
    "environment:",
    "  sdk: '>=3.0.0 <4.0.0'",
    "  flutter: '>=3.10.0'",
    "",
    "dependencies:",
    "  flutter:",
    "    sdk: flutter",
    "  flutter_svg: ^2.0.0",
    "",
    "flutter:",
    "  assets:",
  ];

  for (const dir of assetDirs) {
    const normalized = dir.endsWith("/") ? dir : `${dir}/`;
    lines.push(`    - assets/${normalized}`);
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Generate the package barrel file.
 */
function generateBarrel(fileNames: readonly string[]): string {
  const lines: string[] = [HEADER, ""];
  for (const name of fileNames) {
    lines.push(`export '${name}';`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Narrow unknown domainData to AssetManifest.
 */
function isAssetManifest(value: unknown): value is AssetManifest {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["workspaceName"] === "string" &&
    Array.isArray(value["categories"]) &&
    Array.isArray(value["allEntries"])
  );
}

/**
 * Execute Dart asset codegen — generates typed Flutter widget classes
 * and copies raw asset files into the generated package.
 */
export async function executeDartAssetGeneration(
  _pkg: WorkspacePackage,
  root: string,
  context: ExecutionContext,
): Promise<ExecuteResult> {
  const start = performance.now();

  if (!isAssetManifest(context.domainData)) {
    return {
      success: false,
      duration: 0,
      summary: "No asset manifest provided — assets plugin must scan first",
    };
  }

  const manifest = context.domainData;
  const outDir = context.outputDir;
  if (!outDir) {
    return {
      success: false,
      duration: 0,
      summary: "No outputDir provided",
    };
  }

  const prefix = derivePrefix(manifest.workspaceName);
  const rawSource = (context.sourceName ?? "assets").replace(/^@[^/]+\//, "");
  const packageName = `${manifest.workspaceName}_${rawSource}`;

  // Create output dirs upfront
  const libDir = join(outDir, "lib");
  mkdirSync(libDir, { recursive: true });

  // Copy raw asset files into generated package
  const sourcePath = context.artifactPath;
  if (sourcePath) {
    const sourceDir = join(root, sourcePath);
    const destAssetsDir = join(outDir, "assets");
    if (existsSync(sourceDir)) {
      mkdirSync(destAssetsDir, { recursive: true });
      // Copy all subdirectories that contain assets (derive from manifest)
      const sourceSubDirs = new Set(
        manifest.assetDirectories.map((d) => d.split("/")[0] ?? ""),
      );
      for (const dir of sourceSubDirs) {
        if (!dir) {
          continue;
        }
        const srcSubDir = join(sourceDir, dir);
        if (existsSync(srcSubDir)) {
          cpSync(srcSubDir, join(destAssetsDir, dir), { recursive: true });
        }
      }
    }
  }

  const generatedFiles: string[] = [];

  // Generate category classes (non-themed)
  const themedCategories = new Set(manifest.themeVariants.map((v) => v.category));
  const regularCategories = manifest.categories.filter(
    (cat) => !themedCategories.has(cat.name),
  );

  const regularClasses: string[] = [];
  for (const category of regularCategories) {
    const classCode = generateCategoryClass(category, prefix, packageName);
    if (classCode) {
      regularClasses.push(classCode);
    }
  }

  if (regularClasses.length > 0) {
    const classLines: string[] = [HEADER, ""];
    classLines.push("import 'package:flutter/material.dart';");
    classLines.push("import 'package:flutter_svg/flutter_svg.dart';");
    classLines.push("");
    classLines.push(regularClasses.join("\n\n"));
    classLines.push("");

    const fileName = "icons.generated.dart";
    writeFileSync(join(libDir, fileName), classLines.join("\n"), "utf-8");
    generatedFiles.push(fileName);
  }

  // Generate theme-variant classes
  if (manifest.themeVariants.length > 0) {
    const classLines: string[] = [HEADER, ""];
    classLines.push("import 'package:flutter/material.dart';");
    classLines.push("import 'package:flutter_svg/flutter_svg.dart';");
    classLines.push("");

    for (const variant of manifest.themeVariants) {
      classLines.push(generateThemeVariantClass(variant, prefix, packageName));
      classLines.push("");
    }

    const fileName = "themed_icons.generated.dart";
    writeFileSync(join(libDir, fileName), classLines.join("\n"), "utf-8");
    generatedFiles.push(fileName);
  }

  // Generate pubspec.yaml
  const pubspec = generatePubspec(packageName, manifest.assetDirectories);
  writeFileSync(join(outDir, "pubspec.yaml"), pubspec, "utf-8");

  // Generate barrel file
  if (generatedFiles.length > 0) {
    const barrel = generateBarrel(generatedFiles);
    writeFileSync(join(libDir, `${packageName}.dart`), barrel, "utf-8");
  }

  const duration = Math.round(performance.now() - start);
  return {
    success: true,
    duration,
    summary: `${generatedFiles.length} file(s) + pubspec.yaml + ${manifest.allEntries.length} assets copied`,
  };
}
