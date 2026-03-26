#!/usr/bin/env node
import { join, relative } from "node:path";
import { readdirSync, statSync } from "node:fs";
//#region src/files/resolver.ts
/** Directories always excluded from file resolution */
const ALWAYS_EXCLUDED = [
	"node_modules",
	".dart_tool",
	"build",
	"dist",
	".git"
];
/**
* Normalize an ignore pattern for matching:
*  - Strip leading "./"
*  - A bare name with no glob chars and no extension is treated as a directory prefix
*/
function normalizePattern(pattern) {
	if (pattern.startsWith("./")) return pattern.slice(2);
	return pattern;
}
/**
* Check whether a relative path should be ignored by a set of patterns.
*
* Supports:
*  - Directory prefixes: "generated" matches "generated/foo.ts"
*  - Glob-star suffix:   "generated/**" matches "generated/foo.ts"
*  - File globs:         "*.g.dart" matches "lib/foo.g.dart"
*  - Exact paths:        "src/generated/api.d.ts"
*/
function isIgnored(filePath, patterns) {
	for (const raw of patterns) {
		const pattern = normalizePattern(raw);
		if (pattern.endsWith("/**")) {
			const prefix = pattern.slice(0, -3);
			if (filePath === prefix || filePath.startsWith(prefix + "/")) return true;
			continue;
		}
		if (filePath === pattern) return true;
		if (pattern.startsWith("*.")) {
			const ext = pattern.slice(1);
			if (filePath.endsWith(ext)) return true;
			continue;
		}
		if (!pattern.includes("*") && !pattern.includes("/") && !pattern.includes(".")) {
			if (filePath === pattern || filePath.startsWith(pattern + "/")) return true;
			continue;
		}
		if (!pattern.includes("*")) {
			if (filePath.startsWith(pattern + "/") || filePath === pattern) return true;
		}
	}
	return false;
}
/**
* Resolve files in a package directory for lint/format operations.
*
* Walks the package directory recursively, filters to files matching
* the given extensions, and excludes files matching ignore patterns.
*
* @param packageDir — absolute path to the package directory
* @param extensions — file extensions to include (e.g. ['.ts', '.tsx'])
* @param ignorePatterns — patterns from mido.yml lint.ignore / format.ignore
* @returns relative paths from the package root
*/
function resolveFiles(packageDir, extensions, ignorePatterns) {
	const results = [];
	walkDir(packageDir, packageDir, extensions, ignorePatterns, results);
	return results;
}
function walkDir(dir, packageDir, extensions, ignorePatterns, results) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		if (ALWAYS_EXCLUDED.includes(entry)) continue;
		const fullPath = join(dir, entry);
		const rel = relative(packageDir, fullPath);
		let stat;
		try {
			stat = statSync(fullPath);
		} catch {
			continue;
		}
		if (stat.isDirectory()) {
			if (isIgnored(rel, ignorePatterns)) continue;
			walkDir(fullPath, packageDir, extensions, ignorePatterns, results);
			continue;
		}
		if (!stat.isFile()) continue;
		if (!extensions.some((ext) => entry.endsWith(ext))) continue;
		if (isIgnored(rel, ignorePatterns)) continue;
		results.push(rel);
	}
}
//#endregion
export { resolveFiles as t };

//# sourceMappingURL=resolver-D9ws54tM.js.map