import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadConfig } from "@/config/loader";
import { isRecord } from "@/guards";
import { GREEN, RED, RESET, YELLOW } from "@/output";
import type { ManifestParser } from "@/parsers/types";

/** Well-known platform identifier files that should NOT be auto-renamed */
const PLATFORM_ID_FILES: readonly {
  readonly path: string;
  readonly description: string;
  readonly pattern: RegExp;
}[] = [
  {
    path: "ios/Runner.xcodeproj/project.pbxproj",
    description: "iOS bundle ID (Xcode project)",
    pattern: /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+)/,
  },
  {
    path: "android/app/build.gradle",
    description: "Android application ID (Gradle)",
    pattern: /applicationId\s+["']([^"']+)["']/,
  },
  {
    path: "android/app/build.gradle.kts",
    description: "Android application ID (Gradle Kotlin DSL)",
    pattern: /applicationId\s*=\s*["']([^"']+)["']/,
  },
  {
    path: "macos/Runner.xcodeproj/project.pbxproj",
    description: "macOS bundle ID (Xcode project)",
    pattern: /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+)/,
  },
  {
    path: "google-services.json",
    description: "Firebase config (Android)",
    pattern: /"package_name"\s*:\s*"([^"]+)"/,
  },
  {
    path: "ios/Runner/GoogleService-Info.plist",
    description: "Firebase config (iOS)",
    pattern: /<key>BUNDLE_ID<\/key>\s*<string>([^<]+)<\/string>/,
  },
];

/**
 * Escape a string for safe use inside a RegExp.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Update the workspace name in mido.yml.
 */
function updateMidoYml(root: string, oldName: string, newName: string): boolean {
  const configPath = join(root, "mido.yml");
  if (!existsSync(configPath)) {
    return false;
  }

  const content = readFileSync(configPath, "utf-8");
  const updated = content.replace(
    new RegExp(`^(workspace:\\s*)${escapeRegex(oldName)}`, "m"),
    `$1${newName}`,
  );

  if (updated === content) {
    return false;
  }

  writeFileSync(configPath, updated, "utf-8");
  return true;
}

/**
 * Update package.json name field (for npm/bun workspaces).
 * Replaces @oldName/ scope with @newName/ scope, or oldName prefix with newName.
 */
function updatePackageJson(filePath: string, oldName: string, newName: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return false;
  }
  if (!isRecord(parsed)) {
    return false;
  }

  const name = parsed["name"];
  if (typeof name !== "string") {
    return false;
  }

  let newPkgName = name;
  if (name.startsWith(`@${oldName}/`)) {
    newPkgName = `@${newName}/${name.slice(oldName.length + 2)}`;
  } else if (name.startsWith(`${oldName}-`) || name.startsWith(`${oldName}_`)) {
    const sep = name.charAt(oldName.length);
    newPkgName = `${newName}${sep}${name.slice(oldName.length + 1)}`;
  } else if (name === oldName) {
    newPkgName = newName;
  }

  if (newPkgName === name) {
    return false;
  }

  // Targeted string replacement to preserve formatting
  const updated = content.replace(`"name": "${name}"`, `"name": "${newPkgName}"`);
  writeFileSync(filePath, updated, "utf-8");
  return true;
}

/**
 * Update pubspec.yaml name field.
 * Replaces oldName_ prefix with newName_ prefix.
 */
function updatePubspec(filePath: string, oldName: string, newName: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  const content = readFileSync(filePath, "utf-8");
  const oldPrefix = oldName.replace(/-/g, "_");
  const newPrefix = newName.replace(/-/g, "_");

  const updated = content.replace(
    new RegExp(`^(name:\\s*)${escapeRegex(oldPrefix)}`, "m"),
    `$1${newPrefix}`,
  );

  if (updated === content) {
    return false;
  }

  writeFileSync(filePath, updated, "utf-8");
  return true;
}

/**
 * Update dependency references in pubspec.yaml that reference old workspace packages.
 * Only targets lines in dependency sections (indented key: value pairs).
 */
function updatePubspecDependencies(filePath: string, oldName: string, newName: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  const content = readFileSync(filePath, "utf-8");
  const oldPrefix = oldName.replace(/-/g, "_");
  const newPrefix = newName.replace(/-/g, "_");

  // Only match dependency-style lines: "  package_name:" at the start of a line
  const updated = content.replace(
    new RegExp(`^(\\s+)${escapeRegex(oldPrefix)}_`, "gm"),
    `$1${newPrefix}_`,
  );

  if (updated === content) {
    return false;
  }

  writeFileSync(filePath, updated, "utf-8");
  return true;
}

/**
 * Scan for platform identifiers and return warnings.
 */
function detectPlatformIdentifiers(root: string, ecosystemPaths: readonly string[]): readonly string[] {
  const warnings: string[] = [];

  // Check each app directory from the config
  const appDirs = [...ecosystemPaths, "."];
  for (const appDir of appDirs) {
    for (const entry of PLATFORM_ID_FILES) {
      const filePath = join(root, appDir, entry.path);
      if (!existsSync(filePath)) {
        continue;
      }

      try {
        const content = readFileSync(filePath, "utf-8");
        const match = entry.pattern.exec(content);
        if (match?.[1]) {
          warnings.push(
            `  ${YELLOW}⚠${RESET}  ${entry.description}: ${match[1].trim()} (${appDir}/${entry.path})`,
          );
        }
      } catch {
        // Unreadable file — skip
      }
    }
  }

  return warnings;
}

/**
 * Replace platform identifiers in known files.
 */
function renamePlatformIdentifiers(
  root: string,
  ecosystemPaths: readonly string[],
  oldName: string,
  newName: string,
): readonly string[] {
  const updated: string[] = [];
  const appDirs = [...ecosystemPaths, "."];

  for (const appDir of appDirs) {
    for (const entry of PLATFORM_ID_FILES) {
      const filePath = join(root, appDir, entry.path);
      if (!existsSync(filePath)) {
        continue;
      }

      try {
        const content = readFileSync(filePath, "utf-8");
        // Use the entry's own pattern to do a scoped replacement within the matched value only
        const match = entry.pattern.exec(content);
        if (!match?.[1]) {
          continue;
        }
        const oldValue = match[1].trim();
        const newValue = oldValue.replace(new RegExp(escapeRegex(oldName), "g"), newName);
        if (newValue === oldValue) {
          continue;
        }
        const newContent = content.replace(oldValue, newValue);
        if (newContent !== content) {
          writeFileSync(filePath, newContent, "utf-8");
          updated.push(`${appDir}/${entry.path}`);
        }
      } catch {
        // Unreadable file — skip
      }
    }
  }

  return updated;
}

/**
 * Run the rename command.
 *
 * Updates workspace name in mido.yml, cascades to all package.json and
 * pubspec.yaml files, warns about platform identifiers.
 */
export async function runRename(
  _parsers: ReadonlyMap<string, ManifestParser>,
  newName: string,
  options: { readonly includePlatformIds?: boolean },
): Promise<number> {
  let config;
  try {
    config = await loadConfig(process.cwd());
  } catch {
    console.error(`${RED}✗${RESET} No mido.yml found — run mido init first`);
    return 1;
  }

  const root = config.root;
  const oldName = config.config.workspace;

  if (oldName === newName) {
    console.log(`Workspace is already named "${newName}"`);
    return 0;
  }

  console.log(`\nRenaming workspace: ${oldName} → ${GREEN}${newName}${RESET}\n`);

  const updatedFiles: string[] = [];

  // 1. Update mido.yml
  if (updateMidoYml(root, oldName, newName)) {
    updatedFiles.push("mido.yml");
    console.log(`  ${GREEN}✓${RESET} mido.yml`);
  }

  // 2. Collect all ecosystem package paths
  const allPkgPaths: string[] = [];
  for (const [, eco] of Object.entries(config.config.ecosystems)) {
    if (eco && Array.isArray(eco.packages)) {
      allPkgPaths.push(...eco.packages);
    }
  }

  // 3. Update all ecosystem packages
  for (const [ecosystem, eco] of Object.entries(config.config.ecosystems)) {
    if (!eco || !Array.isArray(eco.packages)) {
      continue;
    }

    for (const pkgPath of eco.packages) {
      const manifestName = ecosystem === "typescript" ? "package.json" : "pubspec.yaml";
      const manifestPath = join(root, pkgPath, manifestName);

      if (ecosystem === "typescript") {
        if (updatePackageJson(manifestPath, oldName, newName)) {
          updatedFiles.push(`${pkgPath}/${manifestName}`);
          console.log(`  ${GREEN}✓${RESET} ${pkgPath}/${manifestName}`);
        }
      } else {
        if (updatePubspec(manifestPath, oldName, newName)) {
          updatedFiles.push(`${pkgPath}/${manifestName}`);
          console.log(`  ${GREEN}✓${RESET} ${pkgPath}/${manifestName}`);
        }
        if (updatePubspecDependencies(manifestPath, oldName, newName)) {
          console.log(`  ${GREEN}✓${RESET} ${pkgPath}/${manifestName} (dependencies)`);
        }
      }
    }
  }

  // 4. Also check root package.json
  const rootPkgJson = join(root, "package.json");
  if (updatePackageJson(rootPkgJson, oldName, newName)) {
    updatedFiles.push("package.json");
    console.log(`  ${GREEN}✓${RESET} package.json`);
  }

  // 5. Platform identifiers
  const platformWarnings = detectPlatformIdentifiers(root, allPkgPaths);

  if (platformWarnings.length > 0) {
    if (options.includePlatformIds) {
      console.log(`\n${YELLOW}Renaming platform identifiers:${RESET}`);
      const renamedPlatform = renamePlatformIdentifiers(root, allPkgPaths, oldName, newName);
      for (const file of renamedPlatform) {
        console.log(`  ${GREEN}✓${RESET} ${file}`);
        updatedFiles.push(file);
      }
      console.log(
        `\n  ${YELLOW}Warning:${RESET} Renaming platform IDs creates a new app identity — users lose the install.`,
      );
    } else {
      console.log(`\n${YELLOW}Platform identifiers detected (not renamed):${RESET}`);
      for (const warning of platformWarnings) {
        console.log(warning);
      }
      console.log(
        `\n  Use ${GREEN}mido rename ${newName} --include-platform-ids${RESET} to rename these too.`,
      );
      console.log(
        `  ${YELLOW}Warning:${RESET} Renaming platform IDs creates a new app identity — users lose the install.`,
      );
    }
  }

  // 6. Remind about regeneration
  console.log(`\n${GREEN}✓${RESET} Renamed ${updatedFiles.length} file(s).`);
  console.log(`  Run ${GREEN}mido generate${RESET} to regenerate bridges with the new name.`);

  return 0;
}
