import { z } from "zod";

/** Schema for npm registry version response (GET /{name}/{version}). */
const npmRepositorySchema = z.union([
  z.object({ type: z.string().optional(), url: z.string() }),
  z.string(),
]);

export const npmVersionResponseSchema = z.object({
  version: z.string(),
  deprecated: z.string().optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  repository: npmRepositorySchema.optional(),
  dist: z
    .object({
      tarball: z.string(),
    })
    .optional(),
});

export type NpmVersionResponse = z.infer<typeof npmVersionResponseSchema>;

/** Schema for pub.dev package response (GET /api/packages/{name}). */
export const pubDevPackageSchema = z.object({
  latest: z.object({
    version: z.string(),
    pubspec: z
      .object({
        name: z.string().optional(),
        dependencies: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  }),
});

export type PubDevPackageResponse = z.infer<typeof pubDevPackageSchema>;

/** Safely parse npm version response. Returns null on failure. */
export function parseNpmVersion(data: unknown): NpmVersionResponse | null {
  const result = npmVersionResponseSchema.safeParse(data);
  return result.success ? result.data : null;
}

/** Safely parse pub.dev package response. Returns null on failure. */
export function parsePubDevPackage(data: unknown): PubDevPackageResponse | null {
  const result = pubDevPackageSchema.safeParse(data);
  return result.success ? result.data : null;
}

// ─── PyPI ────────────────────────────────────────────────────────────────────

export const pyPiPackageSchema = z.object({
  info: z.object({
    version: z.string(),
    home_page: z.string().nullable().optional(),
    project_url: z.string().nullable().optional(),
  }),
  urls: z
    .array(
      z.object({
        filename: z.string(),
        url: z.string(),
        packagetype: z.string().optional(),
      }),
    )
    .optional(),
});

export type PyPiPackageResponse = z.infer<typeof pyPiPackageSchema>;

export function parsePyPiPackage(data: unknown): PyPiPackageResponse | null {
  const result = pyPiPackageSchema.safeParse(data);
  return result.success ? result.data : null;
}

// ─── crates.io ───────────────────────────────────────────────────────────────

export const cratesIoSchema = z.object({
  crate: z.object({
    name: z.string(),
    max_version: z.string(),
    repository: z.string().nullable().optional(),
  }),
  versions: z
    .array(
      z.object({
        num: z.string(),
        yanked: z.boolean().optional(),
        dl_path: z.string().optional(),
      }),
    )
    .optional(),
});

export type CratesIoResponse = z.infer<typeof cratesIoSchema>;

export function parseCratesIo(data: unknown): CratesIoResponse | null {
  const result = cratesIoSchema.safeParse(data);
  return result.success ? result.data : null;
}

// ─── Go proxy ────────────────────────────────────────────────────────────────

export const goProxySchema = z.object({
  Version: z.string(),
  Time: z.string().optional(),
});

export type GoProxyResponse = z.infer<typeof goProxySchema>;

export function parseGoProxy(data: unknown): GoProxyResponse | null {
  const result = goProxySchema.safeParse(data);
  return result.success ? result.data : null;
}

// ─── Packagist ───────────────────────────────────────────────────────────────

const packagistVersionSchema = z.object({
  version: z.string(),
  source: z.object({ url: z.string() }).optional(),
  dist: z.object({ url: z.string() }).optional(),
});

export const packagistPackageSchema = z.object({
  packages: z.record(z.string(), z.array(packagistVersionSchema)),
});

export type PackagistResponse = z.infer<typeof packagistPackageSchema>;

export function parsePackagist(data: unknown): PackagistResponse | null {
  const result = packagistPackageSchema.safeParse(data);
  return result.success ? result.data : null;
}
