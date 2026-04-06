#!/usr/bin/env node
import { r as isRecord } from "./version-M9xRTj7S.js";
import { a as GREEN, f as YELLOW, l as RED, u as RESET } from "./output-MbJ98jNX.js";
import { t as loadConfig } from "./loader-DXAQglVS.js";
import { join, relative } from "node:path";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
//#region src/dry-run.ts
/**
* Format a path for display — show relative to root when possible.
*/
function displayPath(path, root) {
	const rel = relative(root, path);
	return rel.startsWith("..") ? path : rel;
}
/**
* Create a filesystem wrapper that respects dry-run mode.
*
* @param dryRun — when true, logs operations instead of executing them
* @param root — workspace root for display path formatting
*/
function createDryFs(dryRun, root) {
	if (!dryRun) return {
		isDryRun: false,
		writeFile(path, content, encoding = "utf-8") {
			writeFileSync(path, content, encoding);
		},
		mkdir(path, options) {
			mkdirSync(path, options);
		},
		cp(src, dest, options) {
			cpSync(src, dest, options);
		}
	};
	return {
		isDryRun: true,
		writeFile(path, _content) {
			console.log(`  ${YELLOW}dry-run${RESET} write ${GREEN}${displayPath(path, root)}${RESET}`);
		},
		mkdir(path) {
			console.log(`  ${YELLOW}dry-run${RESET} mkdir ${GREEN}${displayPath(path, root)}${RESET}`);
		},
		cp(src, dest) {
			console.log(`  ${YELLOW}dry-run${RESET} copy  ${GREEN}${displayPath(src, root)}${RESET} → ${GREEN}${displayPath(dest, root)}${RESET}`);
		}
	};
}
//#endregion
//#region src/commands/rename.ts
/** Well-known platform identifier files that should NOT be auto-renamed */
const PLATFORM_ID_FILES = [
	{
		path: "ios/Runner.xcodeproj/project.pbxproj",
		description: "iOS bundle ID (Xcode project)",
		pattern: /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+)/
	},
	{
		path: "android/app/build.gradle",
		description: "Android application ID (Gradle)",
		pattern: /applicationId\s+["']([^"']+)["']/
	},
	{
		path: "android/app/build.gradle.kts",
		description: "Android application ID (Gradle Kotlin DSL)",
		pattern: /applicationId\s*=\s*["']([^"']+)["']/
	},
	{
		path: "macos/Runner.xcodeproj/project.pbxproj",
		description: "macOS bundle ID (Xcode project)",
		pattern: /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+)/
	},
	{
		path: "google-services.json",
		description: "Firebase config (Android)",
		pattern: /"package_name"\s*:\s*"([^"]+)"/
	},
	{
		path: "ios/Runner/GoogleService-Info.plist",
		description: "Firebase config (iOS)",
		pattern: /<key>BUNDLE_ID<\/key>\s*<string>([^<]+)<\/string>/
	}
];
/**
* Escape a string for safe use inside a RegExp.
*/
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
* Update the workspace name in mido.yml.
*/
function updateMidoYml(root, oldName, newName, fs) {
	const configPath = join(root, "mido.yml");
	if (!existsSync(configPath)) return false;
	const content = readFileSync(configPath, "utf-8");
	const updated = content.replace(new RegExp(`^(workspace:\\s*)${escapeRegex(oldName)}`, "m"), `$1${newName}`);
	if (updated === content) return false;
	fs.writeFile(configPath, updated, "utf-8");
	return true;
}
/**
* Update package.json name field (for npm/bun workspaces).
* Replaces @oldName/ scope with @newName/ scope, or oldName prefix with newName.
*/
function updatePackageJson(filePath, oldName, newName, fs) {
	if (!existsSync(filePath)) return false;
	let content;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch {
		return false;
	}
	let parsed;
	try {
		parsed = JSON.parse(content);
	} catch {
		return false;
	}
	if (!isRecord(parsed)) return false;
	const name = parsed["name"];
	if (typeof name !== "string") return false;
	let newPkgName = name;
	if (name.startsWith(`@${oldName}/`)) newPkgName = `@${newName}/${name.slice(oldName.length + 2)}`;
	else if (name.startsWith(`${oldName}-`) || name.startsWith(`${oldName}_`)) newPkgName = `${newName}${name.charAt(oldName.length)}${name.slice(oldName.length + 1)}`;
	else if (name === oldName) newPkgName = newName;
	if (newPkgName === name) return false;
	const updated = content.replace(`"name": "${name}"`, `"name": "${newPkgName}"`);
	fs.writeFile(filePath, updated, "utf-8");
	return true;
}
/**
* Update pubspec.yaml name field.
* Replaces oldName_ prefix with newName_ prefix.
*/
function updatePubspec(filePath, oldName, newName, fs) {
	if (!existsSync(filePath)) return false;
	const content = readFileSync(filePath, "utf-8");
	const oldPrefix = oldName.replace(/-/g, "_");
	const newPrefix = newName.replace(/-/g, "_");
	const updated = content.replace(new RegExp(`^(name:\\s*)${escapeRegex(oldPrefix)}`, "m"), `$1${newPrefix}`);
	if (updated === content) return false;
	fs.writeFile(filePath, updated, "utf-8");
	return true;
}
/**
* Update dependency references in pubspec.yaml that reference old workspace packages.
* Only targets lines in dependency sections (indented key: value pairs).
*/
function updatePubspecDependencies(filePath, oldName, newName, fs) {
	if (!existsSync(filePath)) return false;
	const content = readFileSync(filePath, "utf-8");
	const oldPrefix = oldName.replace(/-/g, "_");
	const newPrefix = newName.replace(/-/g, "_");
	const updated = content.replace(new RegExp(`^(\\s+)${escapeRegex(oldPrefix)}_`, "gm"), `$1${newPrefix}_`);
	if (updated === content) return false;
	fs.writeFile(filePath, updated, "utf-8");
	return true;
}
/**
* Scan for platform identifiers and return warnings.
*/
function detectPlatformIdentifiers(root, ecosystemPaths) {
	const warnings = [];
	const appDirs = [...ecosystemPaths, "."];
	for (const appDir of appDirs) for (const entry of PLATFORM_ID_FILES) {
		const filePath = join(root, appDir, entry.path);
		if (!existsSync(filePath)) continue;
		try {
			const content = readFileSync(filePath, "utf-8");
			const match = entry.pattern.exec(content);
			if (match?.[1]) warnings.push(`  ${YELLOW}⚠${RESET}  ${entry.description}: ${match[1].trim()} (${appDir}/${entry.path})`);
		} catch {}
	}
	return warnings;
}
/**
* Replace platform identifiers in known files.
*/
function renamePlatformIdentifiers(root, ecosystemPaths, oldName, newName, fs) {
	const updated = [];
	const appDirs = [...ecosystemPaths, "."];
	for (const appDir of appDirs) for (const entry of PLATFORM_ID_FILES) {
		const filePath = join(root, appDir, entry.path);
		if (!existsSync(filePath)) continue;
		try {
			const content = readFileSync(filePath, "utf-8");
			const match = entry.pattern.exec(content);
			if (!match?.[1]) continue;
			const oldValue = match[1].trim();
			const newValue = oldValue.replace(new RegExp(escapeRegex(oldName), "g"), newName);
			if (newValue === oldValue) continue;
			const newContent = content.replace(oldValue, newValue);
			if (newContent !== content) {
				fs.writeFile(filePath, newContent, "utf-8");
				updated.push(`${appDir}/${entry.path}`);
			}
		} catch {}
	}
	return updated;
}
/**
* Run the rename command.
*
* Updates workspace name in mido.yml, cascades to all package.json and
* pubspec.yaml files, warns about platform identifiers.
*/
async function runRename(_parsers, newName, options) {
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
	const dryRun = options.dryRun ?? false;
	const fs = createDryFs(dryRun, root);
	if (dryRun) console.log(`\n${YELLOW}dry-run${RESET} Renaming workspace: ${oldName} → ${GREEN}${newName}${RESET}\n`);
	else console.log(`\nRenaming workspace: ${oldName} → ${GREEN}${newName}${RESET}\n`);
	const updatedFiles = [];
	if (updateMidoYml(root, oldName, newName, fs)) {
		updatedFiles.push("mido.yml");
		console.log(`  ${GREEN}✓${RESET} mido.yml`);
	}
	const allPkgPaths = [];
	for (const [, eco] of Object.entries(config.config.ecosystems)) if (eco && Array.isArray(eco.packages)) allPkgPaths.push(...eco.packages);
	for (const [ecosystem, eco] of Object.entries(config.config.ecosystems)) {
		if (!eco || !Array.isArray(eco.packages)) continue;
		for (const pkgPath of eco.packages) {
			const manifestName = ecosystem === "typescript" ? "package.json" : "pubspec.yaml";
			const manifestPath = join(root, pkgPath, manifestName);
			if (ecosystem === "typescript") {
				if (updatePackageJson(manifestPath, oldName, newName, fs)) {
					updatedFiles.push(`${pkgPath}/${manifestName}`);
					console.log(`  ${GREEN}✓${RESET} ${pkgPath}/${manifestName}`);
				}
			} else {
				if (updatePubspec(manifestPath, oldName, newName, fs)) {
					updatedFiles.push(`${pkgPath}/${manifestName}`);
					console.log(`  ${GREEN}✓${RESET} ${pkgPath}/${manifestName}`);
				}
				if (updatePubspecDependencies(manifestPath, oldName, newName, fs)) console.log(`  ${GREEN}✓${RESET} ${pkgPath}/${manifestName} (dependencies)`);
			}
		}
	}
	if (updatePackageJson(join(root, "package.json"), oldName, newName, fs)) {
		updatedFiles.push("package.json");
		console.log(`  ${GREEN}✓${RESET} package.json`);
	}
	const platformWarnings = detectPlatformIdentifiers(root, allPkgPaths);
	if (platformWarnings.length > 0) if (options.includePlatformIds) {
		console.log(`\n${YELLOW}Renaming platform identifiers:${RESET}`);
		const renamedPlatform = renamePlatformIdentifiers(root, allPkgPaths, oldName, newName, fs);
		for (const file of renamedPlatform) {
			console.log(`  ${GREEN}✓${RESET} ${file}`);
			updatedFiles.push(file);
		}
		console.log(`\n  ${YELLOW}Warning:${RESET} Renaming platform IDs creates a new app identity — users lose the install.`);
	} else {
		console.log(`\n${YELLOW}Platform identifiers detected (not renamed):${RESET}`);
		for (const warning of platformWarnings) console.log(warning);
		console.log(`\n  Use ${GREEN}mido rename ${newName} --include-platform-ids${RESET} to rename these too.`);
		console.log(`  ${YELLOW}Warning:${RESET} Renaming platform IDs creates a new app identity — users lose the install.`);
	}
	console.log(`\n${GREEN}✓${RESET} Renamed ${updatedFiles.length} file(s).`);
	console.log(`  Run ${GREEN}mido generate${RESET} to regenerate bridges with the new name.`);
	return 0;
}
//#endregion
export { runRename };

//# sourceMappingURL=rename-CQS6gBej.js.map