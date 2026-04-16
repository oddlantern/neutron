import { t as isRecord } from "./guards-VZ6Ej8Ob.js";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { parse } from "yaml";
import { parse as parse$1 } from "smol-toml";
//#region src/parsers/package-json.ts
const DEP_FIELDS$1 = [
	["dependencies", "production"],
	["devDependencies", "dev"],
	["peerDependencies", "peer"],
	["optionalDependencies", "optional"]
];
const manifestSchema$1 = z.record(z.string(), z.unknown());
function extractDeps$3(manifest, field, type) {
	const raw = manifest[field];
	if (!isRecord(raw)) return [];
	return Object.entries(raw).filter((entry) => typeof entry[1] === "string").map(([name, range]) => ({
		name,
		range,
		type
	}));
}
function extractLocalPaths$4(manifest, manifestDir) {
	const paths = [];
	for (const [field] of DEP_FIELDS$1) {
		const raw = manifest[field];
		if (!isRecord(raw)) continue;
		for (const value of Object.values(raw)) {
			if (typeof value !== "string") continue;
			if (value.startsWith("file:")) paths.push(resolve(manifestDir, value.slice(5)));
			else if (value.startsWith("link:")) paths.push(resolve(manifestDir, value.slice(5)));
		}
	}
	return paths;
}
const packageJsonParser = {
	manifestName: "package.json",
	async parse(manifestPath) {
		const content = await readFile(manifestPath, "utf-8");
		const manifest = manifestSchema$1.parse(JSON.parse(content));
		return {
			name: typeof manifest["name"] === "string" ? manifest["name"] : "<unnamed>",
			version: typeof manifest["version"] === "string" ? manifest["version"] : void 0,
			dependencies: DEP_FIELDS$1.flatMap(([field, type]) => extractDeps$3(manifest, field, type)),
			localDependencyPaths: extractLocalPaths$4(manifest, dirname(manifestPath))
		};
	}
};
//#endregion
//#region src/parsers/pubspec.ts
const DEP_FIELDS = [
	["dependencies", "production"],
	["dev_dependencies", "dev"],
	["dependency_overrides", "override"]
];
const manifestSchema = z.record(z.string(), z.unknown());
/**
* Dart dependency values can be:
* - A string version constraint: "^1.2.3"
* - A map with path/git/hosted source: { path: ../shared }
* - null (meaning "any")
*/
function extractDeps$2(manifest, field, type) {
	const raw = manifest[field];
	if (!isRecord(raw)) return [];
	const deps = [];
	for (const [name, value] of Object.entries(raw)) if (typeof value === "string") deps.push({
		name,
		range: value,
		type
	});
	else if (!value) deps.push({
		name,
		range: "any",
		type
	});
	else if (isRecord(value)) if (typeof value["version"] === "string") deps.push({
		name,
		range: value["version"],
		type
	});
	else if ("path" in value || "git" in value || "sdk" in value) deps.push({
		name,
		range: "<local>",
		type
	});
	else deps.push({
		name,
		range: "any",
		type
	});
	return deps;
}
function extractLocalPaths$3(manifest, manifestDir) {
	const paths = [];
	for (const [field] of DEP_FIELDS) {
		const raw = manifest[field];
		if (!isRecord(raw)) continue;
		for (const value of Object.values(raw)) {
			if (!isRecord(value)) continue;
			if (typeof value["path"] === "string") paths.push(resolve(manifestDir, value["path"]));
		}
	}
	return paths;
}
const pubspecParser = {
	manifestName: "pubspec.yaml",
	async parse(manifestPath) {
		const content = await readFile(manifestPath, "utf-8");
		const manifest = manifestSchema.parse(parse(content));
		return {
			name: typeof manifest["name"] === "string" ? manifest["name"] : "<unnamed>",
			version: typeof manifest["version"] === "string" ? manifest["version"] : void 0,
			dependencies: DEP_FIELDS.flatMap(([field, type]) => extractDeps$2(manifest, field, type)),
			localDependencyPaths: extractLocalPaths$3(manifest, dirname(manifestPath))
		};
	}
};
//#endregion
//#region src/parsers/pyproject.ts
/**
* Parse a PEP 508 dependency string (e.g., "requests>=2.28", "click~=8.0").
* Extracts the package name and version specifier.
*/
function parsePep508(spec) {
	const name = spec.match(/^([a-zA-Z0-9][-a-zA-Z0-9_.]*)/)?.[1] ?? spec.trim();
	const afterName = spec.slice(name.length).replace(/\[[^\]]*\]/, "").trim();
	return {
		name,
		range: afterName.startsWith("@") ? "<local>" : afterName || "any"
	};
}
/**
* Extract dependencies from PEP 621 `[project].dependencies` format.
* Each entry is a PEP 508 string.
*/
function extractPep621Deps(project, field, type) {
	const raw = project[field];
	if (!Array.isArray(raw)) return [];
	return raw.filter((item) => typeof item === "string").map((spec) => {
		const { name, range } = parsePep508(spec);
		return {
			name,
			range,
			type
		};
	});
}
/**
* Extract dependencies from PEP 621 `[project].optional-dependencies` format.
*/
function extractOptionalDeps(project) {
	const groups = project["optional-dependencies"];
	if (!isRecord(groups)) return [];
	const deps = [];
	for (const entries of Object.values(groups)) {
		if (!Array.isArray(entries)) continue;
		for (const spec of entries) {
			if (typeof spec !== "string") continue;
			const { name, range } = parsePep508(spec);
			deps.push({
				name,
				range,
				type: "optional"
			});
		}
	}
	return deps;
}
/**
* Extract dependencies from Poetry `[tool.poetry.dependencies]` format.
* Values are either version strings ("^1.2") or tables ({ version = "^1.2", ... }).
*/
function extractPoetryDeps(manifest, field, type) {
	const tool = isRecord(manifest["tool"]) ? manifest["tool"] : null;
	const poetry = tool && isRecord(tool["poetry"]) ? tool["poetry"] : null;
	if (!poetry) return [];
	const raw = poetry[field];
	if (!isRecord(raw)) return [];
	const deps = [];
	for (const [name, value] of Object.entries(raw)) {
		if (name === "python") continue;
		if (typeof value === "string") deps.push({
			name,
			range: value,
			type
		});
		else if (isRecord(value)) if (typeof value["path"] === "string") deps.push({
			name,
			range: "<local>",
			type
		});
		else if (typeof value["version"] === "string") deps.push({
			name,
			range: value["version"],
			type
		});
		else deps.push({
			name,
			range: "any",
			type
		});
	}
	return deps;
}
/**
* Extract local dependency paths from Poetry path deps and PEP 508 file: references.
*/
function extractLocalPaths$2(manifest, project, manifestDir) {
	const paths = [];
	const tool = isRecord(manifest["tool"]) ? manifest["tool"] : null;
	const poetry = tool && isRecord(tool["poetry"]) ? tool["poetry"] : null;
	if (poetry) for (const field of ["dependencies", "dev-dependencies"]) {
		const raw = poetry[field];
		if (!isRecord(raw)) continue;
		for (const value of Object.values(raw)) if (isRecord(value) && typeof value["path"] === "string") paths.push(resolve(manifestDir, value["path"]));
	}
	if (project) {
		const deps = project["dependencies"];
		if (Array.isArray(deps)) for (const spec of deps) {
			if (typeof spec !== "string") continue;
			const fileMatch = spec.match(/@\s*file:(.+)/);
			if (fileMatch?.[1]) paths.push(resolve(manifestDir, fileMatch[1].trim()));
		}
	}
	return paths;
}
const pyprojectParser = {
	manifestName: "pyproject.toml",
	async parse(manifestPath) {
		const manifest = parse$1(await readFile(manifestPath, "utf-8"));
		const project = isRecord(manifest["project"]) ? manifest["project"] : null;
		const tool = isRecord(manifest["tool"]) ? manifest["tool"] : null;
		const poetry = tool && isRecord(tool["poetry"]) ? tool["poetry"] : null;
		const name = (project && typeof project["name"] === "string" ? project["name"] : null) ?? (poetry && typeof poetry["name"] === "string" ? poetry["name"] : null) ?? "<unnamed>";
		const version = (project && typeof project["version"] === "string" ? project["version"] : null) ?? (poetry && typeof poetry["version"] === "string" ? poetry["version"] : null) ?? void 0;
		let dependencies;
		if (project && Array.isArray(project["dependencies"])) dependencies = [...extractPep621Deps(project, "dependencies", "production"), ...extractOptionalDeps(project)];
		else if (poetry) dependencies = [...extractPoetryDeps(manifest, "dependencies", "production"), ...extractPoetryDeps(manifest, "dev-dependencies", "dev")];
		else dependencies = [];
		const localDependencyPaths = extractLocalPaths$2(manifest, project, dirname(manifestPath));
		return {
			name,
			version,
			dependencies,
			localDependencyPaths
		};
	}
};
//#endregion
//#region src/parsers/cargo.ts
/**
* Extract dependencies from a Cargo.toml dependency section.
*
* Values are either:
* - A string version: `serde = "1.0"`
* - A table with version: `serde = { version = "1.0", features = ["derive"] }`
* - A table with path (local dep): `my-lib = { path = "../shared" }`
*/
function extractDeps$1(manifest, field, type) {
	const raw = manifest[field];
	if (!isRecord(raw)) return [];
	const deps = [];
	for (const [name, value] of Object.entries(raw)) if (typeof value === "string") deps.push({
		name,
		range: value,
		type
	});
	else if (isRecord(value)) if (typeof value["path"] === "string") {
		const range = typeof value["version"] === "string" ? value["version"] : "<local>";
		deps.push({
			name,
			range,
			type
		});
	} else if (typeof value["version"] === "string") deps.push({
		name,
		range: value["version"],
		type
	});
	else if (typeof value["git"] === "string") deps.push({
		name,
		range: "<git>",
		type
	});
	else deps.push({
		name,
		range: "any",
		type
	});
	return deps;
}
/**
* Extract local dependency paths from path deps across all sections.
*/
function extractLocalPaths$1(manifest, manifestDir) {
	const paths = [];
	for (const section of [
		"dependencies",
		"dev-dependencies",
		"build-dependencies"
	]) {
		const raw = manifest[section];
		if (!isRecord(raw)) continue;
		for (const value of Object.values(raw)) if (isRecord(value) && typeof value["path"] === "string") paths.push(resolve(manifestDir, value["path"]));
	}
	return paths;
}
const cargoParser = {
	manifestName: "Cargo.toml",
	async parse(manifestPath) {
		const manifest = parse$1(await readFile(manifestPath, "utf-8"));
		const pkg = isRecord(manifest["package"]) ? manifest["package"] : null;
		return {
			name: pkg && typeof pkg["name"] === "string" ? pkg["name"] : "<unnamed>",
			version: pkg && typeof pkg["version"] === "string" ? pkg["version"] : void 0,
			dependencies: [
				...extractDeps$1(manifest, "dependencies", "production"),
				...extractDeps$1(manifest, "dev-dependencies", "dev"),
				...extractDeps$1(manifest, "build-dependencies", "dev")
			],
			localDependencyPaths: extractLocalPaths$1(manifest, dirname(manifestPath))
		};
	}
};
//#endregion
//#region src/parsers/go-mod.ts
/**
* Parse a go.mod file. Line-based format:
*
* ```
* module github.com/org/my-module
*
* go 1.21
*
* require (
*     github.com/gin-gonic/gin v1.9.1
*     github.com/org/shared v0.0.0
* )
*
* replace github.com/org/shared => ../shared
* ```
*/
/** Parse a single require entry like "github.com/foo/bar v1.2.3" */
function parseRequireLine(line) {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("//")) return null;
	const parts = trimmed.split(/\s+/);
	if (parts.length < 2) return null;
	return {
		name: parts[0],
		range: parts[1]
	};
}
const goModParser = {
	manifestName: "go.mod",
	async parse(manifestPath) {
		const lines = (await readFile(manifestPath, "utf-8")).split("\n");
		let name = "<unnamed>";
		const dependencies = [];
		const localPaths = [];
		const manifestDir = dirname(manifestPath);
		let inRequireBlock = false;
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith("module ")) {
				name = trimmed.slice(7).trim();
				continue;
			}
			if (trimmed.startsWith("require (") || trimmed === "require (") {
				inRequireBlock = true;
				continue;
			}
			if (trimmed === ")" && inRequireBlock) {
				inRequireBlock = false;
				continue;
			}
			if (inRequireBlock) {
				const dep = parseRequireLine(trimmed);
				if (dep) dependencies.push({
					name: dep.name,
					range: dep.range,
					type: "production"
				});
				continue;
			}
			if (trimmed.startsWith("require ") && !trimmed.includes("(")) {
				const dep = parseRequireLine(trimmed.slice(8).trim());
				if (dep) dependencies.push({
					name: dep.name,
					range: dep.range,
					type: "production"
				});
				continue;
			}
			if (trimmed.startsWith("replace ")) {
				const arrowIndex = trimmed.indexOf("=>");
				if (arrowIndex === -1) continue;
				const target = trimmed.slice(arrowIndex + 2).trim();
				if (target.startsWith(".") || target.startsWith("/")) {
					const pathPart = target.split(/\s+/)[0];
					localPaths.push(resolve(manifestDir, pathPart));
				}
			}
		}
		return {
			name,
			version: void 0,
			dependencies,
			localDependencyPaths: localPaths
		};
	}
};
//#endregion
//#region src/parsers/composer.ts
/** Platform requirements that are not actual packages */
function isPlatformRequirement(name) {
	return name === "php" || name.startsWith("ext-") || name.startsWith("lib-") || name === "composer";
}
function extractDeps(manifest, field, type) {
	const raw = manifest[field];
	if (!isRecord(raw)) return [];
	return Object.entries(raw).filter((entry) => typeof entry[1] === "string").filter(([name]) => !isPlatformRequirement(name)).map(([name, range]) => ({
		name,
		range,
		type
	}));
}
/**
* Extract local dependency paths from composer.json repositories.
* Path repositories look like: { "type": "path", "url": "../shared" }
*/
function extractLocalPaths(manifest, manifestDir) {
	const repos = manifest["repositories"];
	if (!Array.isArray(repos)) return [];
	const paths = [];
	for (const repo of repos) {
		if (!isRecord(repo)) continue;
		if (repo["type"] === "path" && typeof repo["url"] === "string") paths.push(resolve(manifestDir, repo["url"]));
	}
	return paths;
}
const composerParser = {
	manifestName: "composer.json",
	async parse(manifestPath) {
		const content = await readFile(manifestPath, "utf-8");
		const manifest = JSON.parse(content);
		if (!isRecord(manifest)) throw new Error(`Expected object in ${manifestPath}`);
		return {
			name: typeof manifest["name"] === "string" ? manifest["name"] : "<unnamed>",
			version: typeof manifest["version"] === "string" ? manifest["version"] : void 0,
			dependencies: [...extractDeps(manifest, "require", "production"), ...extractDeps(manifest, "require-dev", "dev")],
			localDependencyPaths: extractLocalPaths(manifest, dirname(manifestPath))
		};
	}
};
//#endregion
export { pubspecParser as a, pyprojectParser as i, goModParser as n, packageJsonParser as o, cargoParser as r, composerParser as t };

//# sourceMappingURL=composer-DfQKH7d7.js.map