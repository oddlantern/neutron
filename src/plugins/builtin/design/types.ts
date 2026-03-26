import type { z } from "zod";

import type {
  designTokensSchema,
  elevationEntrySchema,
  extensionValueSchema,
  shadowLayerSchema,
  typographyScaleEntrySchema,
} from "./token-schema.js";

/** A single shadow layer (used in elevation and standalone shadow tokens) */
export type ShadowLayer = z.infer<typeof shadowLayerSchema>;

/** A single elevation entry with dp and per-theme shadows */
export type ElevationEntry = z.infer<typeof elevationEntrySchema>;

/** A single typography scale entry referencing family + weight keys */
export type TypographyScaleEntry = z.infer<typeof typographyScaleEntrySchema>;

/** Union of possible extension field values */
export type ExtensionValue = z.infer<typeof extensionValueSchema>;

/** Fully validated token data — the output of schema validation */
export type ValidatedTokens = z.infer<typeof designTokensSchema>;

/** Themed color pair */
export interface ThemedColor {
  readonly light: string;
  readonly dark: string;
}

/** Themed number pair */
export interface ThemedNumber {
  readonly light: number;
  readonly dark: number;
}

/** A resolved extension with type info for each field */
export interface ResolvedExtension {
  readonly name: string;
  readonly getter: string;
  readonly fields: ReadonlyMap<string, ResolvedExtensionField>;
}

/**
 * Discriminated union for extension fields.
 * The `type` tag narrows `value` — no `as` casts needed in consumers.
 */
export type ResolvedExtensionField =
  | { readonly name: string; readonly type: "color"; readonly value: ThemedColor }
  | { readonly name: string; readonly type: "color-static"; readonly value: string }
  | { readonly name: string; readonly type: "number"; readonly value: number }
  | { readonly name: string; readonly type: "number-themed"; readonly value: ThemedNumber }
  | { readonly name: string; readonly type: "string"; readonly value: string };

// ─── Type guards ───────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThemedColor(value: unknown): value is ThemedColor {
  return isRecord(value) && typeof value["light"] === "string" && typeof value["dark"] === "string";
}

function isThemedNumber(value: unknown): value is ThemedNumber {
  return isRecord(value) && typeof value["light"] === "number" && typeof value["dark"] === "number";
}

/**
 * Narrow an unknown extension value into a ResolvedExtensionField.
 */
function resolveField(name: string, value: unknown): ResolvedExtensionField {
  if (typeof value === "number") {
    return { name, type: "number", value };
  }
  if (typeof value === "string") {
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
      return { name, type: "color-static", value };
    }
    return { name, type: "string", value };
  }
  if (isThemedColor(value)) {
    return { name, type: "color", value };
  }
  if (isThemedNumber(value)) {
    return { name, type: "number-themed", value };
  }
  // Fallback: coerce to string
  return { name, type: "string", value: String(value) };
}

/**
 * Resolve extensions from validated tokens into typed structures.
 */
export function resolveExtensions(
  extensions: ValidatedTokens["extensions"],
): readonly ResolvedExtension[] {
  if (!extensions) {
    return [];
  }

  const resolved: ResolvedExtension[] = [];

  for (const [name, ext] of Object.entries(extensions)) {
    const fields = new Map<string, ResolvedExtensionField>();
    let getter = name.charAt(0).toLowerCase() + name.slice(1);

    for (const [fieldName, fieldValue] of Object.entries(ext)) {
      if (fieldName === "_getter") {
        if (typeof fieldValue === "string") {
          getter = fieldValue;
        }
        continue;
      }
      fields.set(fieldName, resolveField(fieldName, fieldValue));
    }

    resolved.push({ name, getter, fields });
  }

  return resolved;
}
