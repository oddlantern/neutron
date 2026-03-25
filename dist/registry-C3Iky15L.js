#!/usr/bin/env node
import { t as MIDO_ROOT } from "./version-WDd4fw5u.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
//#region src/plugins/types.ts
/** Standard action names shared across ecosystem plugins */
const STANDARD_ACTIONS = {
	LINT: "lint",
	LINT_FIX: "lint:fix",
	FORMAT: "format",
	FORMAT_CHECK: "format:check",
	BUILD: "build",
	TYPECHECK: "typecheck",
	CODEGEN: "codegen"
};
//#endregion
//#region src/plugins/builtin/exec.ts
/** Maximum bytes of stdout/stderr to accumulate per process */
const MAX_OUTPUT_BYTES$1 = 1024 * 1024;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Read and parse a package.json file from a package directory.
* @param pkgPath — package path relative to workspace root
* @param root — workspace root absolute path
*/
async function readPackageJson(pkgPath, root) {
	const manifestPath = join(root, pkgPath, "package.json");
	const content = await readFile(manifestPath, "utf-8");
	const parsed = JSON.parse(content);
	if (!isRecord(parsed)) throw new Error(`Expected object in ${manifestPath}`);
	return parsed;
}
/** Extract the scripts record from a parsed package.json */
function getScripts(manifest) {
	const scripts = manifest["scripts"];
	if (!isRecord(scripts)) return {};
	const result = {};
	for (const [key, value] of Object.entries(scripts)) if (typeof value === "string") result[key] = value;
	return result;
}
/** Check if a package.json has a dependency in any dependency group */
function hasDep$1(manifest, name) {
	for (const field of [
		"dependencies",
		"devDependencies",
		"peerDependencies"
	]) {
		const deps = manifest[field];
		if (isRecord(deps) && name in deps) return true;
	}
	return false;
}
/**
* Spawn a command and collect its output.
* Does NOT use shell: true — arguments are passed directly to the executable.
*/
function runCommand(command, args, cwd) {
	const start = performance.now();
	return new Promise((resolve) => {
		const child = spawn(command, [...args], {
			cwd,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		const chunks = [];
		let totalBytes = 0;
		child.stdout.on("data", (data) => {
			if (totalBytes < MAX_OUTPUT_BYTES$1) {
				chunks.push(data.toString());
				totalBytes += data.length;
			}
		});
		child.stderr.on("data", (data) => {
			if (totalBytes < MAX_OUTPUT_BYTES$1) {
				chunks.push(data.toString());
				totalBytes += data.length;
			}
		});
		child.on("close", (code) => {
			const duration = Math.round(performance.now() - start);
			const output = chunks.join("");
			if (code === 0) resolve({
				success: true,
				duration,
				summary: `${command} ${args.join(" ")} completed`,
				output
			});
			else resolve({
				success: false,
				duration,
				summary: `${command} ${args.join(" ")} failed (exit ${String(code)})`,
				output
			});
		});
		child.on("error", (err) => {
			resolve({
				success: false,
				duration: Math.round(performance.now() - start),
				summary: `Failed to spawn: ${err.message}`,
				output: err.message
			});
		});
	});
}
//#endregion
//#region src/plugins/builtin/typescript.ts
const WATCH_PATTERNS$1 = ["src/**/*.ts", "src/**/*.tsx"];
const WELL_KNOWN_ACTIONS = [
	"generate",
	"build",
	"dev",
	"codegen"
];
/**
* Parse an openapi-typescript invocation from a package script to extract
* the input artifact path and output path.
*
* Example script: "openapi-typescript ../openapi.prepared.json -o generated/api.d.ts"
* Returns: { input: "../openapi.prepared.json", output: "generated/api.d.ts" }
*/
function parseOpenapiTsScript(scriptValue) {
	const match = /openapi-typescript\s+(\S+).*?\s(?:-o|--output)\s+(\S+)/.exec(scriptValue);
	if (!match) return null;
	const input = match[1];
	const output = match[2];
	if (!input || !output) return null;
	return {
		input,
		output
	};
}
/**
* Detect the openapi-typescript output path from existing scripts.
* Searches generate, openapi:generate, and other scripts for openapi-typescript usage.
* Returns the output path if found in a script.
*/
function detectOutputFromScripts(scripts) {
	for (const name of [
		"generate",
		"openapi:generate",
		"generate:ts",
		"codegen"
	]) {
		const script = scripts[name];
		if (!script) continue;
		const parsed = parseOpenapiTsScript(script);
		if (parsed) return parsed.output;
	}
	for (const script of Object.values(scripts)) {
		const parsed = parseOpenapiTsScript(script);
		if (parsed) return parsed.output;
	}
	return null;
}
/**
* Resolve a binary for a TS tool (linter, formatter).
*
* Resolution order:
*  1. Workspace root node_modules — user override takes precedence
*  2. Mido's own node_modules   — bundled oxlint / oxfmt
*  3. Fall through (null)        — caller can try bare name on PATH
*/
function resolveBin(name, workspaceRoot) {
	const workspaceBin = join(workspaceRoot, "node_modules", ".bin", name);
	if (existsSync(workspaceBin)) return workspaceBin;
	const bundledBin = join(MIDO_ROOT, "node_modules", ".bin", name);
	if (existsSync(bundledBin)) return bundledBin;
	return null;
}
const CACHE_DIR_NAME = "node_modules/.cache/mido";
/** Ensure the cache directory exists and return its absolute path */
function ensureCacheDir(root) {
	const cacheDir = join(root, CACHE_DIR_NAME);
	mkdirSync(cacheDir, { recursive: true });
	return cacheDir;
}
/**
* Generate a temporary oxlintrc.json from the mido lint config.
* Returns the path to the file, or null if no config is needed.
*/
function writeOxlintConfig(root, lint) {
	const hasRules = lint.rules && Object.keys(lint.rules).length > 0;
	const hasIgnore = lint.ignore && lint.ignore.length > 0;
	if (!hasRules && !hasIgnore) return null;
	const config = {};
	if (hasRules) config["rules"] = lint.rules;
	if (hasIgnore) config["ignorePatterns"] = lint.ignore;
	const configPath = join(ensureCacheDir(root), "oxlintrc.json");
	writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
	return configPath;
}
/**
* Generate a temporary oxfmtrc.json from the mido format config.
* All keys except `ignore` are forwarded to the JSON config verbatim.
* Returns the config path and optional ignore path.
*/
function writeOxfmtConfig(root, format) {
	const opts = {};
	for (const [key, value] of Object.entries(format)) if (key !== "ignore") opts[key] = value;
	const hasOpts = Object.keys(opts).length > 0;
	const hasIgnore = format.ignore && format.ignore.length > 0;
	if (!hasOpts && !hasIgnore) return {
		configPath: null,
		ignorePath: null
	};
	const cacheDir = ensureCacheDir(root);
	let configPath = null;
	if (hasOpts) {
		configPath = join(cacheDir, "oxfmtrc.json");
		writeFileSync(configPath, JSON.stringify(opts, null, 2) + "\n", "utf-8");
	}
	let ignorePath = null;
	if (hasIgnore && format.ignore) {
		ignorePath = join(cacheDir, "oxfmt-ignore");
		writeFileSync(ignorePath, format.ignore.join("\n") + "\n", "utf-8");
	}
	return {
		configPath,
		ignorePath
	};
}
/**
* Find the source directory for a TS package.
* Prefers src/, falls back to lib/, then package root.
* When falling back to root, returns it so the caller can decide
* whether to add glob filters for tools that scan recursively.
*/
function findSourceDir(pkg, root) {
	const pkgDir = join(root, pkg.path);
	if (existsSync(join(pkgDir, "src"))) return {
		dir: join(pkgDir, "src"),
		isRoot: false
	};
	if (existsSync(join(pkgDir, "lib"))) return {
		dir: join(pkgDir, "lib"),
		isRoot: false
	};
	return {
		dir: pkgDir,
		isRoot: true
	};
}
/** Well-known output paths for openapi-typescript, checked in order */
const WELL_KNOWN_OUTPUT_PATHS = [
	"generated/api.d.ts",
	"src/generated/api.d.ts",
	"src/api.d.ts"
];
/**
* Resolve the output path for openapi-typescript.
* Priority: existing scripts → existing well-known files → default.
*/
function resolveOutputPath(pkg, root, scripts) {
	const fromScript = detectOutputFromScripts(scripts);
	if (fromScript) return fromScript;
	const pkgDir = join(root, pkg.path);
	for (const candidate of WELL_KNOWN_OUTPUT_PATHS) if (existsSync(join(pkgDir, candidate))) return candidate;
	return "generated/api.d.ts";
}
const typescriptPlugin = {
	type: "ecosystem",
	name: "typescript",
	manifest: "package.json",
	async detect(pkg) {
		return pkg.ecosystem === "typescript";
	},
	async getWatchPatterns() {
		return WATCH_PATTERNS$1;
	},
	async getActions(pkg, root) {
		try {
			const manifest = await readPackageJson(pkg.path, root);
			const scripts = getScripts(manifest);
			const actions = [];
			actions.push(STANDARD_ACTIONS.LINT);
			actions.push(STANDARD_ACTIONS.FORMAT);
			actions.push(STANDARD_ACTIONS.FORMAT_CHECK);
			if (scripts["build"]) actions.push(STANDARD_ACTIONS.BUILD);
			if (hasDep$1(manifest, "typescript") || existsSync(join(root, pkg.path, "tsconfig.json"))) actions.push(STANDARD_ACTIONS.TYPECHECK);
			for (const action of WELL_KNOWN_ACTIONS) if (scripts[action] && !actions.includes(action)) actions.push(action);
			for (const key of Object.keys(scripts)) if (!actions.includes(key) && !key.startsWith("pre") && !key.startsWith("post")) actions.push(key);
			return actions;
		} catch {
			return [];
		}
	},
	async execute(action, pkg, root, context) {
		const cwd = join(root, pkg.path);
		const pm = context.packageManager;
		if (action === STANDARD_ACTIONS.LINT || action === STANDARD_ACTIONS.LINT_FIX) {
			const fix = action === STANDARD_ACTIONS.LINT_FIX;
			const { dir } = findSourceDir(pkg, root);
			const oxlint = resolveBin("oxlint", root);
			if (oxlint) {
				const args = [];
				if (context.lintConfig) {
					const configPath = writeOxlintConfig(root, context.lintConfig);
					if (configPath) args.push("--config", configPath);
				}
				if (fix) args.push("--fix");
				args.push(dir);
				return runCommand(oxlint, args, cwd);
			}
			const eslint = resolveBin("eslint", root);
			if (eslint) return runCommand(eslint, fix ? ["--fix", dir] : [dir], cwd);
			return {
				success: true,
				duration: 0,
				summary: `No linter found for ${pkg.path}. Install oxlint or eslint.`
			};
		}
		if (action === STANDARD_ACTIONS.FORMAT) {
			const { dir, isRoot } = findSourceDir(pkg, root);
			const oxfmt = resolveBin("oxfmt", root);
			if (oxfmt) {
				const args = [];
				if (context.formatConfig) {
					const { configPath, ignorePath } = writeOxfmtConfig(root, context.formatConfig);
					if (configPath) args.push("--config", configPath);
					if (ignorePath) args.push("--ignore-path", ignorePath);
				}
				if (isRoot) args.push("--no-error-on-unmatched-pattern", join(dir, "**/*.ts"), join(dir, "**/*.tsx"));
				else args.push(dir);
				return runCommand(oxfmt, args, cwd);
			}
			const prettier = resolveBin("prettier", root);
			if (prettier) return runCommand(prettier, ["--write", dir], cwd);
			return {
				success: true,
				duration: 0,
				summary: `No formatter found for ${pkg.path}. Install oxfmt or prettier.`
			};
		}
		if (action === STANDARD_ACTIONS.FORMAT_CHECK) {
			const { dir, isRoot } = findSourceDir(pkg, root);
			const oxfmt = resolveBin("oxfmt", root);
			if (oxfmt) {
				const args = ["--check"];
				if (context.formatConfig) {
					const { configPath, ignorePath } = writeOxfmtConfig(root, context.formatConfig);
					if (configPath) args.push("--config", configPath);
					if (ignorePath) args.push("--ignore-path", ignorePath);
				}
				if (isRoot) args.push("--no-error-on-unmatched-pattern", join(dir, "**/*.ts"), join(dir, "**/*.tsx"));
				else args.push(dir);
				return runCommand(oxfmt, args, cwd);
			}
			const prettier = resolveBin("prettier", root);
			if (prettier) return runCommand(prettier, ["--check", dir], cwd);
			return {
				success: true,
				duration: 0,
				summary: `No formatter found for ${pkg.path}. Install oxfmt or prettier.`
			};
		}
		if (action === STANDARD_ACTIONS.BUILD) return runCommand(pm, ["run", "build"], cwd);
		if (action === STANDARD_ACTIONS.TYPECHECK) {
			let scripts = {};
			try {
				scripts = getScripts(await readPackageJson(pkg.path, root));
			} catch {}
			if (scripts["typecheck"]) return runCommand(pm, ["run", "typecheck"], cwd);
			return runCommand(pm === "bun" ? "bunx" : "npx", ["tsc", "--noEmit"], cwd);
		}
		if (action === "generate-openapi-ts") {
			let scripts = {};
			try {
				scripts = getScripts(await readPackageJson(pkg.path, root));
			} catch {}
			const artifactPath = context.artifactPath;
			if (!artifactPath) {
				if (scripts["generate"]) return runCommand(pm, ["run", "generate"], cwd);
				return {
					success: false,
					duration: 0,
					summary: `No artifact path provided and no generate script found in ${pkg.path}`
				};
			}
			const artifactRelative = relative(join(root, pkg.path), join(root, artifactPath));
			const outputPath = resolveOutputPath(pkg, root, scripts);
			return runCommand(pm === "bun" ? "bunx" : "npx", [
				"openapi-typescript",
				artifactRelative,
				"-o",
				outputPath
			], cwd);
		}
		return runCommand(pm, ["run", action], cwd);
	},
	async canHandleDomainArtifact(domain, _artifact, pkg, root) {
		if (domain !== "openapi") return null;
		try {
			const manifest = await readPackageJson(pkg.path, root);
			if (hasDep$1(manifest, "openapi-typescript")) return {
				action: "generate-openapi-ts",
				description: "TypeScript types via openapi-typescript"
			};
			if (getScripts(manifest)["generate"]) return {
				action: "generate",
				description: "Generate via package script"
			};
		} catch {}
		return null;
	},
	async suggestWatchPaths(pkg, root) {
		if (existsSync(join(root, pkg.path, "src"))) return {
			paths: [`${pkg.path}/src/**`],
			reason: `Source directory in ${pkg.path}`
		};
		return {
			paths: [`${pkg.path}/**`],
			reason: `Package root of ${pkg.path}`
		};
	}
};
//#endregion
//#region src/plugins/builtin/dart.ts
const WATCH_PATTERNS = ["lib/**/*.dart", "bin/**/*.dart"];
async function readPubspec(pkg, root) {
	const manifestPath = join(root, pkg.path, "pubspec.yaml");
	const parsed = parse(await readFile(manifestPath, "utf-8"));
	if (!isRecord(parsed)) throw new Error(`Expected object in ${manifestPath}`);
	return parsed;
}
function hasDep(manifest, name) {
	for (const field of [
		"dependencies",
		"dev_dependencies",
		"dependency_overrides"
	]) {
		const deps = manifest[field];
		if (isRecord(deps) && name in deps) return true;
	}
	return false;
}
function isFlutterPackage(manifest) {
	const deps = manifest["dependencies"];
	if (!isRecord(deps)) return false;
	return "flutter" in deps;
}
const dartPlugin = {
	type: "ecosystem",
	name: "dart",
	manifest: "pubspec.yaml",
	async detect(pkg) {
		return pkg.ecosystem === "dart";
	},
	async getWatchPatterns() {
		return WATCH_PATTERNS;
	},
	async getActions(pkg, root) {
		try {
			const manifest = await readPubspec(pkg, root);
			const actions = ["pub-get"];
			actions.push(STANDARD_ACTIONS.LINT);
			actions.push(STANDARD_ACTIONS.FORMAT);
			actions.push(STANDARD_ACTIONS.FORMAT_CHECK);
			if (hasDep(manifest, "build_runner")) {
				actions.push(STANDARD_ACTIONS.BUILD);
				actions.push("codegen");
			}
			if (hasDep(manifest, "swagger_parser")) actions.push("generate-api");
			return actions;
		} catch {
			return ["pub-get"];
		}
	},
	async execute(action, pkg, root) {
		const cwd = join(root, pkg.path);
		let manifest;
		try {
			manifest = await readPubspec(pkg, root);
		} catch {
			manifest = {};
		}
		const flutter = isFlutterPackage(manifest);
		const dartCmd = flutter ? "flutter" : "dart";
		const analyzeCmd = flutter ? "flutter" : "dart";
		switch (action) {
			case STANDARD_ACTIONS.LINT: return runCommand(analyzeCmd, ["analyze", "."], cwd);
			case STANDARD_ACTIONS.LINT_FIX: return runCommand("dart", [
				"fix",
				"--apply",
				"."
			], cwd);
			case STANDARD_ACTIONS.FORMAT: {
				const libDir = join(cwd, "lib");
				const binDir = join(cwd, "bin");
				const targets = [libDir];
				if (existsSync(binDir)) targets.push(binDir);
				return runCommand("dart", ["format", ...targets], cwd);
			}
			case STANDARD_ACTIONS.FORMAT_CHECK: {
				const libDir = join(cwd, "lib");
				const binDir = join(cwd, "bin");
				const targets = [libDir];
				if (existsSync(binDir)) targets.push(binDir);
				return runCommand("dart", [
					"format",
					"--set-exit-if-changed",
					...targets
				], cwd);
			}
			case STANDARD_ACTIONS.BUILD: return runCommand("dart", [
				"run",
				"build_runner",
				"build",
				"--delete-conflicting-outputs"
			], cwd);
			case "pub-get": return runCommand(dartCmd, ["pub", "get"], cwd);
			case "codegen": return runCommand("dart", [
				"run",
				"build_runner",
				"build",
				"--delete-conflicting-outputs"
			], cwd);
			case "generate-api": return runCommand("dart", ["run", "swagger_parser"], cwd);
			case "generate-openapi-dart": {
				const swaggerResult = await runCommand("dart", ["run", "swagger_parser"], cwd);
				if (!swaggerResult.success) return swaggerResult;
				return runCommand("dart", [
					"run",
					"build_runner",
					"build",
					"--delete-conflicting-outputs"
				], cwd);
			}
			default: return {
				success: false,
				duration: 0,
				summary: `Unknown action: ${action}`
			};
		}
	},
	async canHandleDomainArtifact(domain, _artifact, pkg, root) {
		if (domain !== "openapi") return null;
		try {
			if (hasDep(await readPubspec(pkg, root), "swagger_parser")) return {
				action: "generate-openapi-dart",
				description: "Dart client via swagger_parser + build_runner"
			};
		} catch {}
		return null;
	},
	async suggestWatchPaths(pkg, root) {
		if (existsSync(join(root, pkg.path, "lib"))) return {
			paths: [`${pkg.path}/lib/**`],
			reason: `Dart source in ${pkg.path}/lib/`
		};
		return {
			paths: [`${pkg.path}/**`],
			reason: `Package root of ${pkg.path}`
		};
	}
};
//#endregion
//#region src/plugins/builtin/openapi/exporter.ts
/** Default timeout waiting for server to accept connections (ms) */
const DEFAULT_STARTUP_TIMEOUT = 15e3;
/** How often to poll the server during startup (ms) */
const POLL_INTERVAL = 500;
/** Max time to wait for graceful shutdown before SIGKILL (ms) */
const KILL_TIMEOUT = 3e3;
/** Maximum bytes of child output to capture */
const MAX_OUTPUT_BYTES = 256 * 1024;
/** Maximum bytes of HTTP response body to consume from spec endpoint */
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
/**
* Assert that a resolved path stays within the workspace root.
* Prevents path traversal via malicious config values.
*/
function assertWithinRoot(resolved, root) {
	const normalizedRoot = root.endsWith("/") ? root : `${root}/`;
	if (!(resolved.endsWith("/") ? resolved : `${resolved}/`).startsWith(normalizedRoot) && resolved !== root) throw new Error(`Path "${resolved}" escapes workspace root "${root}"`);
}
/** Find a free port by binding to port 0 and closing immediately */
async function findFreePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(/* @__PURE__ */ new Error("Could not allocate a free port"));
				return;
			}
			const port = address.port;
			server.close(() => resolve(port));
		});
		server.on("error", reject);
	});
}
/** Well-known entry files checked in order */
const ENTRY_CANDIDATES = [
	"src/index.ts",
	"src/main.ts",
	"src/app.ts",
	"index.ts",
	"main.ts",
	"app.ts"
];
/**
* Parse an entry file from a script value.
* Handles patterns like: "bun run --watch src/index.ts", "tsx src/index.ts",
* "node dist/index.js", "ts-node src/main.ts"
*/
function parseEntryFromScript(script) {
	return /(?:^|\s)(\S+\.(?:ts|js|mjs|mts))(?:\s|$)/.exec(script)?.[1] ?? null;
}
/**
* Auto-detect the server entry file from an absolute package directory.
* Priority: main field → dev script → start script → well-known paths.
*/
async function detectEntryFile(packageDir) {
	try {
		const content = await readFile(join(packageDir, "package.json"), "utf-8");
		const parsed = JSON.parse(content);
		if (!isRecord(parsed)) throw new Error("Expected object");
		const main = parsed["main"];
		if (typeof main === "string" && existsSync(join(packageDir, main))) return main;
		const scripts = getScripts(parsed);
		for (const scriptName of ["dev", "start"]) {
			const script = scripts[scriptName];
			if (!script) continue;
			const entry = parseEntryFromScript(script);
			if (entry && existsSync(join(packageDir, entry))) return entry;
		}
	} catch {}
	for (const candidate of ENTRY_CANDIDATES) if (existsSync(join(packageDir, candidate))) return candidate;
	return null;
}
/** Kill a child process gracefully, then forcefully if needed */
function killProcess(child) {
	return new Promise((resolve) => {
		if (!child.pid) {
			resolve();
			return;
		}
		let resolved = false;
		const cleanup = () => {
			if (!resolved) {
				resolved = true;
				resolve();
			}
		};
		child.on("exit", cleanup);
		child.on("error", cleanup);
		child.kill("SIGTERM");
		setTimeout(() => {
			if (!resolved && child.pid) try {
				child.kill("SIGKILL");
			} catch {}
			cleanup();
		}, KILL_TIMEOUT);
	});
}
/**
* Poll until the server responds on the given port.
* Returns true if the server started, false on timeout.
*/
async function waitForServer(port, timeout) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 2e3);
		try {
			(await fetch(`http://127.0.0.1:${String(port)}/`, {
				signal: controller.signal,
				redirect: "error"
			})).body?.cancel();
			return true;
		} catch {} finally {
			clearTimeout(timer);
		}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL));
	}
	return false;
}
/**
* Try fetching the spec from a list of paths.
* Returns the parsed JSON and the path that worked, or null with attempt details.
*/
async function fetchSpec(port, paths) {
	const attempts = [];
	for (const specPath of paths) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 1e4);
		try {
			const url = `http://127.0.0.1:${String(port)}${specPath}`;
			const response = await fetch(url, {
				signal: controller.signal,
				redirect: "error"
			});
			if (!response.ok) {
				attempts.push({
					path: specPath,
					status: response.status,
					error: null
				});
				response.body?.cancel();
				continue;
			}
			const contentLength = response.headers.get("content-length");
			if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
				attempts.push({
					path: specPath,
					status: response.status,
					error: "response too large"
				});
				response.body?.cancel();
				continue;
			}
			const text = await response.text();
			if (text.length > MAX_RESPONSE_BYTES) {
				attempts.push({
					path: specPath,
					status: response.status,
					error: "response body too large"
				});
				continue;
			}
			let body;
			try {
				body = JSON.parse(text);
			} catch {
				attempts.push({
					path: specPath,
					status: response.status,
					error: "invalid JSON"
				});
				continue;
			}
			if (!isRecord(body)) {
				attempts.push({
					path: specPath,
					status: response.status,
					error: "response is not a JSON object"
				});
				continue;
			}
			if (!("openapi" in body) && !("swagger" in body)) {
				attempts.push({
					path: specPath,
					status: response.status,
					error: "missing openapi/swagger key"
				});
				continue;
			}
			return {
				spec: body,
				path: specPath,
				attempts
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			attempts.push({
				path: specPath,
				status: null,
				error: msg
			});
			continue;
		} finally {
			clearTimeout(timer);
		}
	}
	return {
		spec: null,
		path: null,
		attempts
	};
}
/**
* Export an OpenAPI spec by booting the server, fetching the spec endpoint,
* writing it to disk, and killing the server.
*/
/** Format fetch attempts into a readable diagnostic string */
function formatAttempts(attempts) {
	if (attempts.length === 0) return "";
	return attempts.map((a) => {
		if (a.status) return `  ${a.path} → ${String(a.status)}${a.error ? ` (${a.error})` : ""}`;
		return `  ${a.path} → ${a.error ?? "unknown error"}`;
	}).join("\n");
}
async function exportSpec(options) {
	const { packageDir, pm, adapter, outputPath, startupTimeout = DEFAULT_STARTUP_TIMEOUT, verbose = false } = options;
	const start = performance.now();
	const debug = verbose ? (msg) => console.error(`  [exporter] ${msg}`) : void 0;
	const entryFile = options.entryFile ?? await detectEntryFile(packageDir);
	debug?.(`entry file: ${entryFile ?? "not found"}`);
	if (!entryFile) return {
		success: false,
		duration: Math.round(performance.now() - start),
		summary: `Could not detect entry file in ${packageDir}. Set entryFile on the bridge.`
	};
	let port;
	try {
		port = await findFreePort();
		debug?.(`allocated port ${String(port)}`);
	} catch {
		return {
			success: false,
			duration: Math.round(performance.now() - start),
			summary: "Port allocation failed. Check if another mido dev instance is running."
		};
	}
	const runnerArgs = pm === "bun" ? ["run", entryFile] : ["tsx", entryFile];
	const runner = pm === "bun" ? "bun" : "npx";
	debug?.(`spawning: ${runner} ${runnerArgs.join(" ")} (cwd: ${packageDir})`);
	const child = spawn(runner, runnerArgs, {
		cwd: packageDir,
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		env: {
			...process.env,
			PORT: String(port)
		}
	});
	const exitHandler = () => {
		try {
			child.kill("SIGKILL");
		} catch {}
	};
	process.on("exit", exitHandler);
	const outputChunks = [];
	let totalBytes = 0;
	const collectOutput = (data) => {
		if (totalBytes < MAX_OUTPUT_BYTES) {
			outputChunks.push(data.toString());
			totalBytes += data.length;
		}
	};
	child.stdout?.on("data", collectOutput);
	child.stderr?.on("data", collectOutput);
	let earlyExit = false;
	let exitCode = null;
	child.on("exit", (code) => {
		earlyExit = true;
		exitCode = code;
		debug?.(`server process exited with code ${String(code)}`);
	});
	try {
		debug?.(`polling http://127.0.0.1:${String(port)}/ (timeout: ${String(startupTimeout)}ms)`);
		const ready = await waitForServer(port, startupTimeout);
		debug?.(`server ready: ${String(ready)}, earlyExit: ${String(earlyExit)}`);
		if (!ready) {
			const serverOutput = outputChunks.join("");
			const timeoutSec = Math.round(startupTimeout / 1e3);
			const reason = earlyExit ? `Server exited with code ${String(exitCode)} before becoming ready` : `Server didn't start within ${String(timeoutSec)}s`;
			return {
				success: false,
				duration: Math.round(performance.now() - start),
				summary: `${reason}. Entry: ${entryFile}`,
				output: serverOutput || void 0
			};
		}
		const specPathOverride = options.specPath;
		const normalize = (p) => p.startsWith("/") ? p : `/${p}`;
		const pathsToTry = specPathOverride ? [normalize(specPathOverride)] : [adapter.defaultSpecPath, ...adapter.fallbackSpecPaths];
		debug?.(`fetching spec from: ${pathsToTry.join(", ")}`);
		const result = await fetchSpec(port, pathsToTry);
		debug?.(`fetch result: ${result.spec ? `found at ${result.path}` : "not found"}`);
		if (!result.spec) {
			const serverOutput = outputChunks.join("");
			const attemptDetails = formatAttempts(result.attempts);
			const details = [attemptDetails ? `Endpoints tried:\n${attemptDetails}` : "", serverOutput ? `Server output:\n${serverOutput.trim().split("\n").slice(0, 10).join("\n")}` : ""].filter(Boolean).join("\n");
			return {
				success: false,
				duration: Math.round(performance.now() - start),
				summary: "Could not find OpenAPI spec. Add an openapi:export script as fallback.",
				output: details || void 0
			};
		}
		debug?.(`writing spec to ${outputPath}`);
		try {
			const outputDir = dirname(outputPath);
			if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true });
			await writeFile(outputPath, JSON.stringify(result.spec, null, 2) + "\n", "utf-8");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				success: false,
				duration: Math.round(performance.now() - start),
				summary: `Failed to write spec: ${msg}`
			};
		}
		debug?.(`export complete`);
		return {
			success: true,
			duration: Math.round(performance.now() - start),
			summary: `exported from ${result.path}`
		};
	} finally {
		debug?.(`killing server process`);
		await killProcess(child);
		process.removeListener("exit", exitHandler);
	}
}
/**
* Detect a framework adapter for a package.
* Reads the package.json and checks all adapters.
*/
async function detectFrameworkAdapter(pkgPath, root) {
	const { detectAdapter } = await import("./adapters-r5VqmblT.js");
	try {
		const manifest = await readPackageJson(pkgPath, root);
		const allDeps = {};
		for (const field of [
			"dependencies",
			"devDependencies",
			"peerDependencies"
		]) {
			const deps = manifest[field];
			if (isRecord(deps)) {
				for (const [name, version] of Object.entries(deps)) if (typeof version === "string") allDeps[name] = version;
			}
		}
		return detectAdapter(allDeps);
	} catch {
		return null;
	}
}
//#endregion
//#region src/plugins/builtin/openapi/plugin.ts
const OPENAPI_FILENAMES = new Set([
	"openapi.json",
	"openapi.yaml",
	"openapi.yml",
	"swagger.json",
	"swagger.yaml"
]);
/** Server framework packages that produce OpenAPI specs */
const SERVER_FRAMEWORKS = new Map([
	["elysia", ["src/routes/**", "src/routes/**/*.ts"]],
	["express", ["src/routes/**", "routes/**"]],
	["fastify", ["src/routes/**", "routes/**"]],
	["hono", ["src/routes/**", "src/**/*.ts"]],
	["koa", ["src/routes/**", "routes/**"]],
	["@nestjs/core", ["src/**/*.controller.ts", "src/**/*.ts"]]
]);
/** Patterns in script values that indicate spec preparation */
const PREPARE_SCRIPT_PATTERNS = [
	"spec",
	"openapi",
	"swagger",
	"dart",
	"prepare"
];
/**
* Detect if the source package has a prepare script that post-processes
* the OpenAPI spec. Checks for well-known script names and patterns.
*/
async function detectPrepareScript(source, root) {
	try {
		const scripts = getScripts(await readPackageJson(source.path, root));
		for (const name of [
			"openapi:prepare",
			"spec:prepare",
			"prepare-spec"
		]) if (scripts[name]) return { scriptName: name };
		const prepareScript = scripts["prepare"];
		if (prepareScript) {
			const lower = prepareScript.toLowerCase();
			const matchesPattern = PREPARE_SCRIPT_PATTERNS.some((p) => lower.includes(p));
			const isNpmDefault = lower === "husky" || lower === "mido install" || lower.startsWith("npm ");
			if (matchesPattern && !isNpmDefault) return { scriptName: "prepare" };
		}
	} catch {}
	return null;
}
/**
* Find which package in the workspace has the server framework that
* actually produces the routes. Returns the package and its adapter.
* Only scans TypeScript packages — other ecosystems are not yet supported.
*/
async function findServerPackage(packages, root) {
	for (const [, pkg] of packages) {
		if (pkg.ecosystem !== "typescript") continue;
		const adapter = await detectFrameworkAdapter(pkg.path, root);
		if (adapter) return {
			path: pkg.path,
			adapter
		};
	}
	return null;
}
/**
* Find which package in the workspace has the server framework that
* actually produces the routes. Returns watch path suggestions.
*/
async function findRouteSource(packages, root) {
	for (const [, pkg] of packages) {
		if (pkg.ecosystem !== "typescript") continue;
		try {
			const manifest = await readPackageJson(pkg.path, root);
			for (const [framework, defaultPatterns] of SERVER_FRAMEWORKS) if (hasDep$1(manifest, framework)) return {
				paths: existsSync(join(root, pkg.path, "src", "routes")) ? [`${pkg.path}/src/routes/**`] : defaultPatterns.map((p) => `${pkg.path}/${p}`),
				reason: `Detected ${framework} routes in ${pkg.path}`
			};
		} catch {}
	}
	return null;
}
/**
* Determine which artifact path downstream generators should consume.
* If a prepared spec exists, prefer it over the raw spec.
*/
function resolveArtifactForDownstream(artifact, root) {
	const ext = artifact.includes(".") ? artifact.slice(artifact.lastIndexOf(".")) : "";
	const preparedPath = `${artifact.slice(0, artifact.length - ext.length)}.prepared${ext}`;
	if (existsSync(join(root, preparedPath))) return preparedPath;
	return artifact;
}
/**
* Try exporting the spec using the adapter-based exporter.
* Scans workspace packages for a server framework, boots it, and fetches the spec.
*/
async function tryAdapterExport(source, artifact, root, context) {
	let adapter = await detectFrameworkAdapter(source.path, root);
	let serverPkgPath = source.path;
	if (!adapter) {
		const serverInfo = await findServerPackage(context.graph.packages, root);
		if (!serverInfo) return null;
		adapter = serverInfo.adapter;
		serverPkgPath = serverInfo.path;
	}
	const packageDir = resolve(root, serverPkgPath);
	const outputPath = resolve(root, artifact);
	assertWithinRoot(packageDir, root);
	assertWithinRoot(outputPath, root);
	const bridge = context.graph.bridges.find((b) => b.source === source.path && b.artifact === artifact);
	return exportSpec({
		packageDir,
		pm: context.packageManager,
		adapter,
		outputPath,
		entryFile: bridge?.entryFile,
		specPath: bridge?.specPath,
		verbose: context.verbose
	});
}
const openapiPlugin = {
	type: "domain",
	name: "openapi",
	async detectBridge(artifact) {
		const filename = basename(artifact);
		return OPENAPI_FILENAMES.has(filename);
	},
	async exportArtifact(source, artifact, root, context) {
		const adapterResult = await tryAdapterExport(source, artifact, root, context);
		if (adapterResult?.success) return adapterResult;
		const sourceHandler = (await context.findEcosystemHandlers("openapi", artifact)).find((h) => h.pkg.path === source.path);
		if (sourceHandler) return sourceHandler.plugin.execute(sourceHandler.capability.action, source, root, context);
		try {
			const scripts = getScripts(await readPackageJson(source.path, root));
			const exportScriptName = scripts["openapi:export"] ? "openapi:export" : scripts["swagger:export"] ? "swagger:export" : null;
			if (exportScriptName) {
				const cwd = join(root, source.path);
				return runCommand(context.packageManager, ["run", exportScriptName], cwd);
			}
		} catch {}
		return {
			success: false,
			duration: 0,
			summary: `No export method found for ${source.path} — install an OpenAPI plugin for your framework or add an openapi:export script`
		};
	},
	async generateDownstream(artifact, targets, root, context) {
		const resolvedArtifact = resolveArtifactForDownstream(artifact, root);
		const handlers = await context.findEcosystemHandlers("openapi", resolvedArtifact);
		const targetPaths = new Set(targets.map((t) => t.path));
		const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));
		if (relevantHandlers.length === 0) return [];
		const ctxWithArtifact = {
			...context,
			artifactPath: resolvedArtifact
		};
		const results = [];
		for (const handler of relevantHandlers) {
			const result = await handler.plugin.execute(handler.capability.action, handler.pkg, root, ctxWithArtifact);
			results.push(result);
		}
		return results;
	},
	async buildPipeline(source, artifact, targets, root, context) {
		const steps = [];
		const ext = artifact.includes(".") ? artifact.slice(artifact.lastIndexOf(".")) : "";
		const base = artifact.slice(0, artifact.length - ext.length);
		steps.push({
			name: "export-spec",
			plugin: "openapi",
			description: "exporting spec...",
			outputPaths: [artifact],
			execute: () => openapiPlugin.exportArtifact(source, artifact, root, context)
		});
		const prepareInfo = await detectPrepareScript(source, root);
		if (prepareInfo) {
			const cwd = join(root, source.path);
			const preparedArtifact = `${base}.prepared${ext}`;
			steps.push({
				name: "prepare-spec",
				plugin: "openapi",
				description: "preparing spec...",
				outputPaths: [preparedArtifact, artifact],
				execute: () => runCommand(context.packageManager, ["run", prepareInfo.scriptName], cwd)
			});
		}
		const downstreamArtifact = prepareInfo ? `${base}.prepared${ext}` : artifact;
		const handlers = await context.findEcosystemHandlers("openapi", downstreamArtifact);
		const targetPaths = new Set(targets.map((t) => t.path));
		const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));
		const ctxWithArtifact = {
			...context,
			artifactPath: downstreamArtifact
		};
		for (const handler of relevantHandlers) steps.push({
			name: `generate-${handler.plugin.name}`,
			plugin: handler.plugin.name,
			description: `${handler.capability.description}...`,
			execute: () => handler.plugin.execute(handler.capability.action, handler.pkg, root, ctxWithArtifact)
		});
		return steps;
	},
	async suggestWatchPaths(source, _artifact, packages, root) {
		try {
			const manifest = await readPackageJson(source.path, root);
			for (const [framework] of SERVER_FRAMEWORKS) if (hasDep$1(manifest, framework)) return {
				paths: existsSync(join(root, source.path, "src", "routes")) ? [`${source.path}/src/routes/**`] : [`${source.path}/src/**`],
				reason: `Detected ${framework} in ${source.path}`
			};
		} catch {}
		return findRouteSource(packages, root);
	}
};
//#endregion
//#region src/plugins/loader.ts
/**
* Load all plugins — builtins are always present.
*
* External plugins from devDependencies (mido-plugin-*) will be loaded
* on top of builtins when the external plugin system is implemented.
*/
function loadPlugins() {
	return {
		ecosystem: [typescriptPlugin, dartPlugin],
		domain: [openapiPlugin]
	};
}
//#endregion
//#region src/plugins/registry.ts
/**
* Holds loaded plugins and provides context factory for plugin execution.
*/
var PluginRegistry = class {
	ecosystemPlugins;
	domainPlugins;
	constructor(ecosystem, domain) {
		this.ecosystemPlugins = ecosystem;
		this.domainPlugins = domain;
	}
	/** Find the ecosystem plugin for a package based on its ecosystem name */
	getEcosystemForPackage(pkg) {
		return this.ecosystemPlugins.find((p) => p.name === pkg.ecosystem);
	}
	/** Find the domain plugin that can handle a bridge artifact */
	async getDomainForArtifact(artifact, root) {
		for (const plugin of this.domainPlugins) if (await plugin.detectBridge(artifact, root)) return plugin;
	}
	/** Find all ecosystem plugins that can handle a domain artifact across target packages */
	async findEcosystemHandlers(domain, artifact, targets, root) {
		const handlers = [];
		for (const pkg of targets) for (const plugin of this.ecosystemPlugins) {
			if (!plugin.canHandleDomainArtifact) continue;
			const capability = await plugin.canHandleDomainArtifact(domain, artifact, pkg, root);
			if (capability) handlers.push({
				plugin,
				pkg,
				capability
			});
		}
		return handlers;
	}
	/**
	* Ask plugins to suggest watch paths for a bridge.
	* Domain plugins get priority (they understand the artifact type).
	* Falls back to ecosystem plugin suggestions.
	*/
	async suggestWatchPaths(source, artifact, packages, root) {
		const domain = await this.getDomainForArtifact(artifact, root);
		if (domain?.suggestWatchPaths) {
			const suggestion = await domain.suggestWatchPaths(source, artifact, packages, root);
			if (suggestion) return suggestion;
		}
		const ecosystem = this.getEcosystemForPackage(source);
		if (ecosystem?.suggestWatchPaths) return ecosystem.suggestWatchPaths(source, root);
		return null;
	}
	/** Create an ExecutionContext for plugin execution */
	createContext(graph, root, packageManager, options) {
		return {
			graph,
			root,
			packageManager,
			verbose: options?.verbose,
			lintConfig: options?.lintConfig,
			formatConfig: options?.formatConfig,
			findEcosystemHandlers: async (domain, artifact) => {
				const allTargets = [...graph.packages.values()];
				return this.findEcosystemHandlers(domain, artifact, allTargets, root);
			}
		};
	}
};
//#endregion
export { loadPlugins as n, STANDARD_ACTIONS as r, PluginRegistry as t };

//# sourceMappingURL=registry-C3Iky15L.js.map