import { z } from 'zod';

const ecosystemSchema = z.object({
  manifest: z.string(),
  lockfile: z.string().optional(),
  packages: z.array(z.string()).min(1),
});

const bridgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  via: z.string(),
});

const envSchema = z.object({
  shared: z.array(z.string()).min(1),
  files: z.array(z.string()).min(2),
});

export const configSchema = z.object({
  workspace: z.string(),
  ecosystems: z.record(z.string(), ecosystemSchema).refine(
    (eco) => Object.keys(eco).length >= 1,
    { message: 'At least one ecosystem must be defined' },
  ),
  bridges: z.array(bridgeSchema).optional(),
  env: envSchema.optional(),
});

export type MidoConfig = z.infer<typeof configSchema>;
export type EcosystemConfig = z.infer<typeof ecosystemSchema>;
export type BridgeConfig = z.infer<typeof bridgeSchema>;
export type EnvConfig = z.infer<typeof envSchema>;
