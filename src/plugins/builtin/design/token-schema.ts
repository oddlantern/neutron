import { z } from "zod";

// ─── Primitives ────────────────────────────────────────────────────────────

/** Accepts #RRGGBB hex or rgba(...) color values */
const colorValue = z
  .string()
  .refine((v) => /^#[0-9a-fA-F]{6}$/.test(v) || /^rgba?\(/.test(v), {
    message: "expected hex (#RRGGBB) or rgba() color",
  });

const themedColor = z.object({
  light: colorValue,
  dark: colorValue,
});

const nonNegativeNumber = z.number().nonnegative();

// ─── Shadow ────────────────────────────────────────────────────────────────

export const shadowLayerSchema = z.object({
  x: z.number(),
  y: z.number(),
  blur: z.number().nonnegative(),
  spread: z.number(),
  color: colorValue,
  opacity: z.number().min(0).max(1),
});

const shadowArray = z.array(shadowLayerSchema);

const shadowPair = z.object({
  light: shadowArray,
  dark: shadowArray,
});

// ─── Elevation ─────────────────────────────────────────────────────────────

export const elevationEntrySchema = z.object({
  dp: z.number().nonnegative(),
  shadow: shadowPair,
});

// ─── Typography ────────────────────────────────────────────────────────────

const fontProvider = z.enum(["asset", "google_fonts", "none"]).default("asset");

const fontWeightMap = z.record(z.string(), z.number().int().min(100).max(900));

export const typographyScaleEntrySchema = z.object({
  size: nonNegativeNumber,
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

// ─── Standard section keys ─────────────────────────────────────────────────

/** Keys that mido recognizes as standard sections */
const STANDARD_KEYS = new Set([
  "meta",
  "brand",
  "color",
  "spacing",
  "radius",
  "elevation",
  "shadowCard",
  "iconSize",
  "typography",
]);

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

// ─── Standard sections schema ──────────────────────────────────────────────

const standardSchema = z.object({
  meta: z.record(z.string(), z.unknown()).optional(),
  brand: z.record(z.string(), colorValue).optional(),
  color: z.record(z.string(), themedColor),
  spacing: z.record(z.string(), nonNegativeNumber).optional(),
  radius: z.record(z.string(), nonNegativeNumber).optional(),
  elevation: z.record(z.string(), elevationEntrySchema).optional(),
  shadowCard: shadowPair.optional(),
  iconSize: z.record(z.string(), nonNegativeNumber).optional(),
  typography: typographySchema.optional(),
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

/** Parsed standard sections */
export interface StandardTokens {
  readonly brand: Readonly<Record<string, string>>;
  readonly color: Readonly<Record<string, { readonly light: string; readonly dark: string }>>;
  readonly spacing: Readonly<Record<string, number>>;
  readonly radius: Readonly<Record<string, number>>;
  readonly elevation: Readonly<Record<string, z.infer<typeof elevationEntrySchema>>>;
  readonly shadowCard: z.infer<typeof shadowPair> | undefined;
  readonly iconSize: Readonly<Record<string, number>>;
  readonly typography: z.infer<typeof typographySchema> | undefined;
}

/** Parsed extension metadata */
export interface ExtensionMeta {
  readonly className: string;
  readonly getter: string;
}

/** A single custom extension section */
export interface ParsedExtension {
  readonly meta: ExtensionMeta;
  readonly fields: Readonly<Record<string, { readonly light: string; readonly dark: string }>>;
}

/** Top-level validated token structure */
export interface ValidatedTokens {
  readonly standard: StandardTokens;
  readonly extensions: Readonly<Record<string, ParsedExtension>>;
}

export interface TokenValidationResult {
  readonly success: boolean;
  readonly data: ValidatedTokens | undefined;
  readonly errors: readonly TokenValidationError[];
  readonly warnings: readonly TokenValidationWarning[];
}

/**
 * Convert a section key to PascalCase class name.
 * "extended" → "Extended", "genreColors" → "GenreColors"
 */
function toPascalCase(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Convert a section key to camelCase getter name.
 * "Extended" → "extended", "GenreColors" → "genreColors"
 */
function toCamelCase(key: string): string {
  return key.charAt(0).toLowerCase() + key.slice(1);
}

/**
 * Parse an extension section. Separates _metadata fields from token fields.
 */
function parseExtension(
  key: string,
  raw: Record<string, unknown>,
): { readonly parsed: ParsedExtension; readonly errors: readonly TokenValidationError[] } {
  const errors: TokenValidationError[] = [];
  const fields: Record<string, { readonly light: string; readonly dark: string }> = {};

  let className = toPascalCase(key);
  let getter = toCamelCase(key);

  for (const [fieldName, fieldValue] of Object.entries(raw)) {
    // Metadata fields start with _
    if (fieldName === "_className" && typeof fieldValue === "string") {
      className = fieldValue;
      continue;
    }
    if (fieldName === "_getter" && typeof fieldValue === "string") {
      getter = fieldValue;
      continue;
    }
    if (fieldName.startsWith("_")) {
      continue;
    }

    // Token fields must be themed colors
    const result = themedColor.safeParse(fieldValue);
    if (result.success) {
      fields[fieldName] = result.data;
    } else {
      errors.push({
        path: `${key}.${fieldName}`,
        message: `expected { light: color, dark: color }, got ${typeof fieldValue}`,
      });
    }
  }

  return {
    parsed: { meta: { className, getter }, fields },
    errors,
  };
}

/**
 * Validate a parsed tokens.json against the mido-design token schema.
 * Standard sections are validated by Zod. Any unknown top-level key
 * is treated as a custom extension section.
 */
export function validateTokens(raw: unknown): TokenValidationResult {
  const errors: TokenValidationError[] = [];
  const warnings: TokenValidationWarning[] = [];

  if (typeof raw !== "object" || !raw) {
    errors.push({ path: "(root)", message: "expected an object" });
    return { success: false, data: undefined, errors, warnings };
  }

  const obj = raw as Record<string, unknown>;

  // 1. Validate standard sections
  const standardResult = standardSchema.safeParse(obj);
  if (!standardResult.success) {
    for (const issue of standardResult.error.issues) {
      errors.push({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      });
    }
    return { success: false, data: undefined, errors, warnings };
  }

  const std = standardResult.data;

  // 2. Check required M3 color roles
  for (const role of REQUIRED_COLOR_ROLES) {
    if (!(role in std.color)) {
      errors.push({
        path: `color.${role}`,
        message: "missing (required for M3 ColorScheme)",
      });
    }
  }

  if (errors.length > 0) {
    return { success: false, data: undefined, errors, warnings };
  }

  // 3. Warn on missing optional M3 color roles
  for (const role of OPTIONAL_COLOR_ROLES) {
    if (!(role in std.color)) {
      warnings.push({
        path: `color.${role}`,
        message: "missing optional M3 ColorScheme role",
      });
    }
  }

  // 4. Discover and parse extension sections (any key not in STANDARD_KEYS)
  const extensions: Record<string, ParsedExtension> = {};

  for (const key of Object.keys(obj)) {
    if (STANDARD_KEYS.has(key)) {
      continue;
    }

    const sectionValue = obj[key];
    if (typeof sectionValue !== "object" || !sectionValue || Array.isArray(sectionValue)) {
      continue;
    }

    const { parsed, errors: extErrors } = parseExtension(
      key,
      sectionValue as Record<string, unknown>,
    );
    errors.push(...extErrors);
    extensions[key] = parsed;
  }

  if (errors.length > 0) {
    return { success: false, data: undefined, errors, warnings };
  }

  // 5. Assemble validated tokens
  const data: ValidatedTokens = {
    standard: {
      brand: std.brand ?? {},
      color: std.color,
      spacing: std.spacing ?? {},
      radius: std.radius ?? {},
      elevation: std.elevation ?? {},
      shadowCard: std.shadowCard,
      iconSize: std.iconSize ?? {},
      typography: std.typography,
    },
    extensions,
  };

  return { success: true, data, errors, warnings };
}
