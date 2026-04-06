import { z } from "zod";

const ecosystemSchema = z.object({
  manifest: z.string(),
  lockfile: z.string().optional(),
  packages: z.array(z.string()).min(1),
});

/** Supported design token output formats (autocomplete via JSON schema). */
export const DESIGN_FORMATS = ["css", "tailwind", "material3", "bootstrap", "tokens"] as const;

/** A consumer is either a path string or an object with path + optional format. */
const consumerSchema = z.union([
  z.string(),
  z.object({
    path: z.string(),
    format: z.enum(DESIGN_FORMATS).optional(),
  }),
]);

const bridgeSchema = z
  .object({
    source: z.string(),
    artifact: z.string(),
    consumers: z.array(consumerSchema).min(1).optional(),
    /** @deprecated since v0.4.0. Use `consumers` instead. Auto-migrated on load. */
    target: z.string().optional(),
    run: z.string().regex(/^[a-zA-Z0-9_:. /-]+$/, "bridge.run must not contain shell metacharacters").optional(),
    watch: z.array(z.string()).optional(),
    entryFile: z.string().optional(),
    specPath: z.string().optional(),
    /** Path prefixes to exclude from generated output */
    exclude: z.array(z.string()).optional(),
  })
  .refine((b) => b.consumers || b.target, {
    message: "Bridge must have either 'consumers' or 'target'",
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

const formatPythonSchema = z
  .object({
    lineLength: z.number().optional(),
    indentWidth: z.number().optional(),
    quoteStyle: z.enum(["single", "double"]).optional(),
  })
  .passthrough();

const formatRustSchema = z
  .object({
    edition: z.enum(["2015", "2018", "2021", "2024"]).optional(),
    maxWidth: z.number().optional(),
    tabSpaces: z.number().optional(),
    useSmallHeuristics: z.enum(["Default", "Off", "Max"]).optional(),
  })
  .passthrough();

const formatGoSchema = z
  .object({
    simplify: z.boolean().optional(),
  })
  .passthrough();

const formatPhpSchema = z
  .object({
    rules: z.record(z.string(), z.unknown()).optional(),
    preset: z.enum(["psr12", "psr2", "symfony", "laravel", "per"]).optional(),
  })
  .passthrough();

const formatSchema = z.object({
  ignore: z.array(z.string()).optional(),
  typescript: formatTypescriptSchema.optional(),
  dart: formatDartSchema.optional(),
  python: formatPythonSchema.optional(),
  rust: formatRustSchema.optional(),
  go: formatGoSchema.optional(),
  php: formatPhpSchema.optional(),
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

const lintPythonSchema = z.object({
  select: z.array(z.string()).optional(),
  ignore: z.array(z.string()).optional(),
  fixable: z.array(z.string()).optional(),
  targetVersion: z.string().optional(),
});

const lintRustSchema = z.object({
  denyWarnings: z.boolean().optional(),
  features: z.array(z.string()).optional(),
});

const lintGoSchema = z.object({
  enable: z.array(z.string()).optional(),
  disable: z.array(z.string()).optional(),
  timeout: z.string().optional(),
});

const lintPhpSchema = z.object({
  level: z.number().int().min(0).max(9).optional(),
  paths: z.array(z.string()).optional(),
});

const lintSchema = z.object({
  ignore: z.array(z.string()).optional(),
  typescript: lintTypescriptSchema.optional(),
  dart: lintDartSchema.optional(),
  python: lintPythonSchema.optional(),
  rust: lintRustSchema.optional(),
  go: lintGoSchema.optional(),
  php: lintPhpSchema.optional(),
});

// ─── Hooks schema ─────────────────────────────────────────────────────────────

/** A hook is either an array of shell commands or `false` to disable it. */
const hookStepsSchema = z.union([z.array(z.string()).min(1), z.literal(false)]);

const HOOK_NAMES = ["pre-commit", "commit-msg", "post-merge", "post-checkout"] as const;

const hooksSchema = z.object({
  "pre-commit": hookStepsSchema.optional(),
  "commit-msg": hookStepsSchema.optional(),
  "post-merge": hookStepsSchema.optional(),
  "post-checkout": hookStepsSchema.optional(),
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
  hooks: hooksSchema.optional(),
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
export type FormatPythonConfig = z.infer<typeof formatPythonSchema>;
export type FormatRustConfig = z.infer<typeof formatRustSchema>;
export type FormatGoConfig = z.infer<typeof formatGoSchema>;
export type FormatPhpConfig = z.infer<typeof formatPhpSchema>;
export type LintPythonConfig = z.infer<typeof lintPythonSchema>;
export type LintRustConfig = z.infer<typeof lintRustSchema>;
export type LintGoConfig = z.infer<typeof lintGoSchema>;
export type LintPhpConfig = z.infer<typeof lintPhpSchema>;

export type HooksConfig = z.infer<typeof hooksSchema>;

export { DEFAULT_COMMIT_TYPES, HOOK_NAMES };
