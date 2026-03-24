#!/usr/bin/env node
import { n as closePrompt, t as ask } from "./prompt-BLf9wcmi.js";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { stringify } from "yaml";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
//#region src/discovery/scanner.ts
/** Directories to always skip during scanning */
const SKIP_DIRS = new Set([
	"node_modules",
	".dart_tool",
	"build",
	"dist",
	".git",
	".husky",
	".idea",
	".vscode"
]);
/** Manifest filenames and their ecosystem names */
const MANIFEST_MAP = new Map([
	["package.json", "typescript"],
	["pubspec.yaml", "dart"],
	["Cargo.toml", "rust"],
	["pyproject.toml", "python"]
]);
/** Ecosystems that mido currently supports */
const SUPPORTED_ECOSYSTEMS = new Set(["typescript", "dart"]);
/**
* Load .gitignore patterns from root. Returns a simple set of directory names
* to skip (not full glob support — just top-level directory names).
*/
function loadGitignoreDirs(root) {
	const gitignorePath = join(root, ".gitignore");
	const dirs = /* @__PURE__ */ new Set();
	if (!existsSync(gitignorePath)) return dirs;
	try {
		const content = readFileSync(gitignorePath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const cleaned = trimmed.replace(/\/$/, "");
			if (cleaned && !cleaned.includes("*") && !cleaned.includes("/")) dirs.add(cleaned);
		}
	} catch {}
	return dirs;
}
/**
* Check if a package.json at root level is a workspace root (not a real package).
*/
async function isWorkspaceRoot(manifestPath) {
	try {
		const raw = await readFile(manifestPath, "utf-8");
		const parsed = JSON.parse(raw);
		if (parsed["workspaces"]) return true;
		if (parsed["private"] === true) {
			if (!existsSync(join(manifestPath, "..", "src"))) return true;
		}
		return false;
	} catch {
		return false;
	}
}
/**
* Scan a repository root for ecosystem markers.
* Returns all discovered packages (both supported and unsupported).
*/
async function scanRepo(root) {
	const gitignoreDirs = loadGitignoreDirs(root);
	const skipAll = new Set([...SKIP_DIRS, ...gitignoreDirs]);
	const packages = [];
	async function walk(dir) {
		let entries;
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (skipAll.has(entry)) continue;
			const fullPath = join(dir, entry);
			let stat;
			try {
				stat = statSync(fullPath);
			} catch {
				continue;
			}
			if (!stat.isDirectory()) continue;
			for (const [manifest, ecosystem] of MANIFEST_MAP) {
				const manifestPath = join(fullPath, manifest);
				if (!existsSync(manifestPath)) continue;
				const relPath = relative(root, fullPath);
				if (manifest === "package.json" && relPath === ".") {
					if (await isWorkspaceRoot(manifestPath)) continue;
				}
				packages.push({
					path: relPath,
					ecosystem,
					manifest,
					supported: SUPPORTED_ECOSYSTEMS.has(ecosystem)
				});
			}
			await walk(fullPath);
		}
	}
	for (const [manifest, ecosystem] of MANIFEST_MAP) {
		const manifestPath = join(root, manifest);
		if (!existsSync(manifestPath)) continue;
		if (manifest === "package.json") {
			if (await isWorkspaceRoot(manifestPath)) continue;
		}
		packages.push({
			path: ".",
			ecosystem,
			manifest,
			supported: SUPPORTED_ECOSYSTEMS.has(ecosystem)
		});
	}
	await walk(root);
	return packages;
}
//#endregion
//#region src/discovery/heuristics.ts
const ARTIFACT_FILENAMES = [
	"openapi.json",
	"openapi.yaml",
	"swagger.json",
	"tokens.json"
];
/**
* Detect potential bridge candidates between packages of different ecosystems.
*/
async function detectBridges(root, packages) {
	const candidates = [];
	const packagesByPath = new Map(packages.map((p) => [p.path, p]));
	for (const pkg of packages) {
		const pkgDir = resolve(root, pkg.path);
		for (const artifactName of ARTIFACT_FILENAMES) {
			const artifactPath = join(pkgDir, artifactName);
			if (!existsSync(artifactPath)) continue;
			const artifactRel = relative(root, artifactPath);
			for (const other of packages) {
				if (other.path === pkg.path || other.ecosystem === pkg.ecosystem) continue;
				if (isPlausibleConsumer(pkg.path, other.path)) candidates.push({
					source: pkg.path,
					target: other.path,
					artifact: artifactRel,
					reason: `Found ${artifactName} in ${pkg.path}`
				});
			}
		}
	}
	for (const pkg of packages) {
		if (pkg.ecosystem !== "dart") continue;
		const pubspecPath = join(root, pkg.path, "pubspec.yaml");
		try {
			const raw = await readFile(pubspecPath, "utf-8");
			const pathDepPattern = /path:\s+(.+)/g;
			let match;
			while ((match = pathDepPattern.exec(raw)) !== null) {
				const depPath = match[1]?.trim();
				if (!depPath) continue;
				const relPath = relative(root, resolve(root, pkg.path, depPath));
				const targetPkg = packagesByPath.get(relPath);
				if (targetPkg && targetPkg.ecosystem !== "dart") candidates.push({
					source: targetPkg.path,
					target: pkg.path,
					artifact: `${targetPkg.path}/openapi.json`,
					reason: `Dart path dependency from ${pkg.path} to ${targetPkg.path}`
				});
			}
		} catch {}
	}
	const seen = /* @__PURE__ */ new Set();
	const unique = [];
	for (const candidate of candidates) {
		const key = `${candidate.source}:${candidate.target}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(candidate);
	}
	return unique;
}
/**
* Check if a consumer path is plausibly related to a producer path.
* E.g., packages/api/clients/dart is a plausible consumer of packages/api.
*/
function isPlausibleConsumer(producerPath, consumerPath) {
	if (consumerPath.startsWith(producerPath + "/")) return true;
	if (dirname(producerPath) === dirname(consumerPath)) return true;
	return false;
}
/**
* Find .env.example and .env.template files across the repo.
*/
function detectEnvFiles(root, packages) {
	const candidates = [];
	const envNames = [".env.example", ".env.template"];
	for (const pkg of packages) {
		const pkgDir = resolve(root, pkg.path);
		for (const envName of envNames) {
			const envPath = join(pkgDir, envName);
			if (existsSync(envPath)) candidates.push({ path: relative(root, envPath) });
		}
	}
	return candidates;
}
//#endregion
//#region src/commands/init.ts
const RESET = "\x1B[0m";
const BOLD = "\x1B[1m";
const DIM = "\x1B[2m";
const CYAN = "\x1B[36m";
const YELLOW = "\x1B[33m";
const CONFIG_FILENAME = "mido.yml";
/**
* Interactive setup that scans the repo and generates mido.yml.
*
* @returns exit code (0 = success, 1 = error)
*/
async function runInit(root) {
	const configPath = join(root, CONFIG_FILENAME);
	if (existsSync(configPath)) {
		if ((await ask(`${CONFIG_FILENAME} already exists. Overwrite? [y/N] `)).toLowerCase() !== "y") {
			console.log("Aborted.");
			closePrompt();
			return 0;
		}
	}
	console.log(`\n${CYAN}${BOLD}mido init${RESET} ${DIM}— scanning repo...${RESET}\n`);
	const discovered = await scanRepo(root);
	if (discovered.length === 0) {
		console.log("No ecosystem packages found. Nothing to configure.");
		closePrompt();
		return 1;
	}
	const supported = discovered.filter((p) => p.supported);
	const unsupported = discovered.filter((p) => !p.supported);
	if (unsupported.length > 0) {
		for (const pkg of unsupported) console.log(`  ${YELLOW}⚠${RESET} ${pkg.ecosystem} detected at ${pkg.path} (not yet supported)`);
		console.log("");
	}
	if (supported.length === 0) {
		console.log("No supported ecosystem packages found.");
		closePrompt();
		return 1;
	}
	const ecosystems = groupByEcosystem(supported);
	console.log("  Ecosystems:");
	for (const [name, group] of Object.entries(ecosystems)) {
		console.log(`    ${BOLD}${name}${RESET} (${group.packages.length} packages)`);
		for (const pkg of group.packages) console.log(`      ${pkg}`);
	}
	const bridgeCandidates = await detectBridges(root, supported);
	if (bridgeCandidates.length > 0) {
		console.log(`\n  Bridges:`);
		for (const bridge of bridgeCandidates) {
			console.log(`    ${bridge.source} → ${bridge.target}`);
			console.log(`      ${DIM}via ${bridge.artifact}${RESET}`);
		}
	}
	const envFiles = detectEnvFiles(root, supported);
	if (envFiles.length >= 2) {
		console.log(`\n  Env files:`);
		for (const env of envFiles) console.log(`    ${env.path}`);
	}
	console.log("");
	if ((await ask(`  Write ${CONFIG_FILENAME}? [Y/n] `)).toLowerCase() === "n") {
		console.log("Aborted.");
		closePrompt();
		return 0;
	}
	const dirName = root.split("/").pop() ?? "workspace";
	const config = {
		workspace: await ask(`  Workspace name [${dirName}]: `) || dirName,
		ecosystems
	};
	if (bridgeCandidates.length > 0) config["bridges"] = bridgeCandidates.map((b) => ({
		source: b.source,
		target: b.target,
		artifact: b.artifact
	}));
	if (envFiles.length >= 2) config["env"] = {
		shared: [],
		files: envFiles.map((e) => e.path)
	};
	await writeFile(configPath, stringify(config, { lineWidth: 120 }), "utf-8");
	console.log(`\n  ${BOLD}${CONFIG_FILENAME}${RESET} written\n`);
	const installAnswer = await ask("  Install git hooks? [Y/n] ");
	closePrompt();
	if (installAnswer.toLowerCase() !== "n") {
		const { runInstall } = await import("./install-BRkV1UYQ.js");
		return runInstall(root);
	}
	return 0;
}
function groupByEcosystem(packages) {
	const groups = {};
	const manifestNames = {
		typescript: "package.json",
		dart: "pubspec.yaml"
	};
	for (const pkg of packages) {
		if (!groups[pkg.ecosystem]) groups[pkg.ecosystem] = {
			manifest: manifestNames[pkg.ecosystem] ?? pkg.manifest,
			packages: []
		};
		const group = groups[pkg.ecosystem];
		if (group) group.packages.push(pkg.path);
	}
	for (const group of Object.values(groups)) group.packages.sort();
	return groups;
}
//#endregion
export { runInit };

//# sourceMappingURL=init-By2M_cDZ.js.map