import { z } from 'zod';

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
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
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

const lintSchema = z.object({
  rules: z.record(z.string(), z.unknown()).optional(),
  ignore: z.array(z.string()).optional(),
});

/**
 * Format config is a passthrough — all keys from the source
 * (oxfmtrc.json / prettierrc) are preserved and forwarded to
 * oxfmt at runtime. Only `ignore` is handled specially (written
 * to a separate ignore file instead of the config JSON).
 */
const formatSchema = z
  .object({
    ignore: z.array(z.string()).optional(),
  })
  .passthrough();

export const configSchema = z.object({
  workspace: z.string(),
  ecosystems: z.record(z.string(), ecosystemSchema).refine((eco) => Object.keys(eco).length >= 1, {
    message: 'At least one ecosystem must be defined',
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
export type FormatConfig = z.infer<typeof formatSchema>;

export { DEFAULT_COMMIT_TYPES };
