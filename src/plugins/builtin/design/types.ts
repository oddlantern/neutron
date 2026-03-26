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

/** Detected type of an extension value */
export type ExtensionFieldType = "color" | "color-static" | "number" | "number-themed" | "string";

/** A resolved extension with type info for each field */
export interface ResolvedExtension {
  readonly name: string;
  readonly getter: string;
  readonly fields: ReadonlyMap<string, ResolvedExtensionField>;
}

/** A single field in a resolved extension */
export interface ResolvedExtensionField {
  readonly name: string;
  readonly type: ExtensionFieldType;
  readonly value: ExtensionValue;
}

/**
 * Detect the type of an extension value from its shape.
 */
export function detectExtensionFieldType(value: ExtensionValue): ExtensionFieldType {
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "string") {
    return /^#[0-9a-fA-F]{6}$/.test(value) ? "color-static" : "string";
  }
  // Object with light/dark
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj["light"] === "string" && typeof obj["dark"] === "string") {
      return "color";
    }
    if (typeof obj["light"] === "number" && typeof obj["dark"] === "number") {
      return "number-themed";
    }
  }
  return "string";
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
      fields.set(fieldName, {
        name: fieldName,
        type: detectExtensionFieldType(fieldValue as ExtensionValue),
        value: fieldValue as ExtensionValue,
      });
    }

    resolved.push({ name, getter, fields });
  }

  return resolved;
}
