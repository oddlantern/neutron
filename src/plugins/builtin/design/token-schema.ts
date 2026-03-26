import { z } from "zod";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const hexColor = z.string().regex(HEX_COLOR, "invalid hex color (expected #RRGGBB)");

const themedColor = z.object({
  light: hexColor,
  dark: hexColor,
});

const positiveNumber = z.number().positive();

// ─── Shadow ────────────────────────────────────────────────────────────────

export const shadowLayerSchema = z.object({
  x: z.number(),
  y: z.number(),
  blur: z.number().nonnegative(),
  spread: z.number(),
  color: hexColor,
  opacity: z.number().min(0).max(1),
});

const shadowArray = z.array(shadowLayerSchema).min(1);

const themedShadow = z.object({
  light: shadowArray,
  dark: shadowArray,
});

// ─── Elevation ─────────────────────────────────────────────────────────────

export const elevationEntrySchema = z.object({
  dp: z.number().nonnegative(),
  shadow: themedShadow,
});

// ─── Typography ────────────────────────────────────────────────────────────

const fontProvider = z.enum(["asset", "google_fonts", "none"]).default("asset");

const fontWeightMap = z.record(z.string(), z.number().int().min(100).max(900));

export const typographyScaleEntrySchema = z.object({
  size: positiveNumber,
  weight: z.string(),
  family: z.string(),
  letterSpacing: z.number().optional(),
  height: z.number().optional(),
});

const typographySchema = z
  .object({
    provider: fontProvider,
    fontFamily: z.record(z.string(), z.string()),
    fontWeight: fontWeightMap,
    scale: z.record(z.string(), typographyScaleEntrySchema),
  })
  .refine(
    (data) => {
      for (const entry of Object.values(data.scale)) {
        if (!(entry.family in data.fontFamily)) {
          return false;
        }
        if (!(entry.weight in data.fontWeight)) {
          return false;
        }
      }
      return true;
    },
    {
      message: "typography.scale entries must reference valid fontFamily and fontWeight keys",
    },
  );

// ─── Extensions ────────────────────────────────────────────────────────────

export const extensionValueSchema = z.union([
  themedColor,
  hexColor,
  z.number(),
  z.object({ light: z.number(), dark: z.number() }),
  z.string(),
]);

const extensionFields = z.record(z.string(), z.union([extensionValueSchema, z.string()]));

// ─── Root schema ───────────────────────────────────────────────────────────

/** Required M3 ColorScheme fields */
const REQUIRED_COLOR_ROLES: readonly string[] = [
  "primary",
  "onPrimary",
  "surface",
  "onSurface",
  "error",
  "onError",
];

/** Optional M3 ColorScheme fields — warn if missing */
const OPTIONAL_COLOR_ROLES: readonly string[] = [
  "primaryContainer",
  "onPrimaryContainer",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "errorContainer",
  "onErrorContainer",
  "surfaceDim",
  "surfaceBright",
  "surfaceContainerLowest",
  "surfaceContainerLow",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
  "onSurfaceVariant",
  "outline",
  "outlineVariant",
  "inverseSurface",
  "onInverseSurface",
  "inversePrimary",
  "scrim",
  "shadow",
];

export const designTokensSchema = z.object({
  brand: z.record(z.string(), hexColor).optional(),
  color: z.record(z.string(), themedColor),
  spacing: z.record(z.string(), positiveNumber).optional(),
  radius: z.record(z.string(), z.number().nonnegative()).optional(),
  elevation: z.record(z.string(), elevationEntrySchema).optional(),
  shadowCard: themedShadow.optional(),
  iconSize: z.record(z.string(), positiveNumber).optional(),
  typography: typographySchema.optional(),
  extensions: z.record(z.string(), extensionFields).optional(),
});

// ─── Validation ────────────────────────────────────────────────────────────

export interface TokenValidationError {
  readonly path: string;
  readonly message: string;
}

export interface TokenValidationWarning {
  readonly path: string;
  readonly message: string;
}

export interface TokenValidationResult {
  readonly success: boolean;
  readonly data: z.infer<typeof designTokensSchema> | undefined;
  readonly errors: readonly TokenValidationError[];
  readonly warnings: readonly TokenValidationWarning[];
}

/**
 * Validate a parsed tokens.json against the design token schema.
 * Returns typed data on success, structured errors on failure.
 */
export function validateTokens(raw: unknown): TokenValidationResult {
  const errors: TokenValidationError[] = [];
  const warnings: TokenValidationWarning[] = [];

  const result = designTokensSchema.safeParse(raw);

  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      });
    }
    return { success: false, data: undefined, errors, warnings };
  }

  const data = result.data;

  // Check required M3 color roles
  for (const role of REQUIRED_COLOR_ROLES) {
    if (!(role in data.color)) {
      errors.push({
        path: `color.${role}`,
        message: "missing (required for M3 ColorScheme)",
      });
    }
  }

  if (errors.length > 0) {
    return { success: false, data: undefined, errors, warnings };
  }

  // Warn on missing optional M3 color roles
  for (const role of OPTIONAL_COLOR_ROLES) {
    if (!(role in data.color)) {
      warnings.push({
        path: `color.${role}`,
        message: "missing optional M3 ColorScheme role",
      });
    }
  }

  return { success: true, data, errors, warnings };
}
