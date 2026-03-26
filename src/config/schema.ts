import { z } from "zod";

const ecosystemSchema = z.object({
  manifest: z.string(),
  lockfile: z.string().optional(),
  packages: z.array(z.string()).min(1),
});

const bridgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  artifact: z.string(),
  run: z.string().optional(),
  watch: z.array(z.string()).optional(),
  entryFile: z.string().optional(),
  specPath: z.string().optional(),
});

const envSchema = z.object({
  shared: z.array(z.string()).min(1),
  files: z.array(z.string()).min(2),
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
  "revert",
] as const;

const commitsSchema = z.object({
  types: z
    .array(z.string())
    .min(1)
    .default([...DEFAULT_COMMIT_TYPES]),
  scopes: z.array(z.string()).optional(),
  header_max_length: z.number().int().positive().default(100),
  body_max_line_length: z.number().int().positive().default(200),
});

// ─── Format schemas (per-ecosystem) ──────────────────────────────────────────

const formatTypescriptSchema = z
  .object({
    printWidth: z.number().optional(),
    tabWidth: z.number().optional(),
    useTabs: z.boolean().optional(),
    semi: z.boolean().optional(),
    singleQuote: z.boolean().optional(),
    jsxSingleQuote: z.boolean().optional(),
    trailingComma: z.enum(["all", "none", "es5"]).optional(),
    bracketSpacing: z.boolean().optional(),
    bracketSameLine: z.boolean().optional(),
    arrowParens: z.enum(["always", "avoid"]).optional(),
    proseWrap: z.enum(["preserve", "always", "never"]).optional(),
    singleAttributePerLine: z.boolean().optional(),
    endOfLine: z.enum(["lf", "crlf", "cr", "auto"]).optional(),
  })
  .passthrough();

const formatDartSchema = z
  .object({
    lineLength: z.number().optional(),
  })
  .passthrough();

const formatSchema = z.object({
  ignore: z.array(z.string()).optional(),
  typescript: formatTypescriptSchema.optional(),
  dart: formatDartSchema.optional(),
});

// ─── Lint schemas (per-ecosystem) ────────────────────────────────────────────

const lintCategoryLevel = z.enum(["off", "warn", "error"]);

const lintTypescriptSchema = z.object({
  categories: z
    .object({
      correctness: lintCategoryLevel.optional(),
      suspicious: lintCategoryLevel.optional(),
      pedantic: lintCategoryLevel.optional(),
      perf: lintCategoryLevel.optional(),
      style: lintCategoryLevel.optional(),
      restriction: lintCategoryLevel.optional(),
      nursery: lintCategoryLevel.optional(),
    })
    .optional(),
  rules: z.record(z.string(), z.unknown()).optional(),
});

const lintDartSchema = z.object({
  strict: z.boolean().optional(),
});

const lintSchema = z.object({
  ignore: z.array(z.string()).optional(),
  typescript: lintTypescriptSchema.optional(),
  dart: lintDartSchema.optional(),
});

export const configSchema = z.object({
  workspace: z.string(),
  ecosystems: z.record(z.string(), ecosystemSchema).refine((eco) => Object.keys(eco).length >= 1, {
    message: "At least one ecosystem must be defined",
  }),
  bridges: z.array(bridgeSchema).optional(),
  env: envSchema.optional(),
  commits: commitsSchema.optional(),
  lint: lintSchema.optional(),
  format: formatSchema.optional(),
});

export type MidoConfig = z.infer<typeof configSchema>;
export type EcosystemConfig = z.infer<typeof ecosystemSchema>;
export type BridgeConfig = z.infer<typeof bridgeSchema>;
export type EnvConfig = z.infer<typeof envSchema>;
export type CommitsConfig = z.infer<typeof commitsSchema>;
export type LintConfig = z.infer<typeof lintSchema>;
export type LintTypescriptConfig = z.infer<typeof lintTypescriptSchema>;
export type LintDartConfig = z.infer<typeof lintDartSchema>;
export type FormatConfig = z.infer<typeof formatSchema>;
export type FormatTypescriptConfig = z.infer<typeof formatTypescriptSchema>;
export type FormatDartConfig = z.infer<typeof formatDartSchema>;

export { DEFAULT_COMMIT_TYPES };
