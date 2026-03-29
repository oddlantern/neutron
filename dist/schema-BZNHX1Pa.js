#!/usr/bin/env node
import { z } from "zod";
//#region src/config/schema.ts
const ecosystemSchema = z.object({
	manifest: z.string(),
	lockfile: z.string().optional(),
	packages: z.array(z.string()).min(1)
});
const bridgeSchema = z.object({
	source: z.string(),
	artifact: z.string(),
	consumers: z.array(z.string()).min(1).optional(),
	target: z.string().optional(),
	run: z.string().regex(/^[a-zA-Z0-9_:. /-]+$/, "bridge.run must not contain shell metacharacters").optional(),
	watch: z.array(z.string()).optional(),
	entryFile: z.string().optional(),
	specPath: z.string().optional(),
	exclude: z.array(z.string()).optional()
}).refine((b) => b.consumers || b.target, { message: "Bridge must have either 'consumers' or 'target'" });
const envSchema = z.object({
	shared: z.array(z.string()).min(1),
	files: z.array(z.string()).min(2)
});
const DEFAULT_COMMIT_TYPES = [
	"feat",
	"fix",
	"docs",
	"style",
	"refactor",
	"perf",
	"test",
	"build",
	"ci",
	"chore",
	"revert"
];
const commitsSchema = z.object({
	types: z.array(z.string()).min(1).default([...DEFAULT_COMMIT_TYPES]),
	scopes: z.array(z.string()).optional(),
	header_max_length: z.number().int().positive().default(100),
	body_max_line_length: z.number().int().positive().default(200)
});
const formatTypescriptSchema = z.object({
	printWidth: z.number().optional(),
	tabWidth: z.number().optional(),
	useTabs: z.boolean().optional(),
	semi: z.boolean().optional(),
	singleQuote: z.boolean().optional(),
	jsxSingleQuote: z.boolean().optional(),
	trailingComma: z.enum([
		"all",
		"none",
		"es5"
	]).optional(),
	bracketSpacing: z.boolean().optional(),
	bracketSameLine: z.boolean().optional(),
	arrowParens: z.enum(["always", "avoid"]).optional(),
	proseWrap: z.enum([
		"preserve",
		"always",
		"never"
	]).optional(),
	singleAttributePerLine: z.boolean().optional(),
	endOfLine: z.enum([
		"lf",
		"crlf",
		"cr",
		"auto"
	]).optional()
}).passthrough();
const formatDartSchema = z.object({ lineLength: z.number().optional() }).passthrough();
const formatSchema = z.object({
	ignore: z.array(z.string()).optional(),
	typescript: formatTypescriptSchema.optional(),
	dart: formatDartSchema.optional()
});
const lintCategoryLevel = z.enum([
	"off",
	"warn",
	"error"
]);
const lintTypescriptSchema = z.object({
	categories: z.object({
		correctness: lintCategoryLevel.optional(),
		suspicious: lintCategoryLevel.optional(),
		pedantic: lintCategoryLevel.optional(),
		perf: lintCategoryLevel.optional(),
		style: lintCategoryLevel.optional(),
		restriction: lintCategoryLevel.optional(),
		nursery: lintCategoryLevel.optional()
	}).optional(),
	rules: z.record(z.string(), z.unknown()).optional()
});
const lintDartSchema = z.object({ strict: z.boolean().optional() });
const lintSchema = z.object({
	ignore: z.array(z.string()).optional(),
	typescript: lintTypescriptSchema.optional(),
	dart: lintDartSchema.optional()
});
/** A hook is either an array of shell commands or `false` to disable it. */
const hookStepsSchema = z.union([z.array(z.string()).min(1), z.literal(false)]);
const HOOK_NAMES = [
	"pre-commit",
	"commit-msg",
	"post-merge",
	"post-checkout"
];
const hooksSchema = z.object({
	"pre-commit": hookStepsSchema.optional(),
	"commit-msg": hookStepsSchema.optional(),
	"post-merge": hookStepsSchema.optional(),
	"post-checkout": hookStepsSchema.optional()
});
const configSchema = z.object({
	workspace: z.string(),
	ecosystems: z.record(z.string(), ecosystemSchema).refine((eco) => Object.keys(eco).length >= 1, { message: "At least one ecosystem must be defined" }),
	bridges: z.array(bridgeSchema).optional(),
	env: envSchema.optional(),
	commits: commitsSchema.optional(),
	lint: lintSchema.optional(),
	format: formatSchema.optional(),
	hooks: hooksSchema.optional()
});
//#endregion
export { HOOK_NAMES as n, configSchema as r, DEFAULT_COMMIT_TYPES as t };

//# sourceMappingURL=schema-BZNHX1Pa.js.map