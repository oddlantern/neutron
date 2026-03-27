import type { ValidatedTokens } from "../design/types.js";

const HEADER = `/* GENERATED — DO NOT EDIT. Changes will be overwritten. */`;

/** Radius values at or above this threshold are treated as unitless (e.g., pill shapes) */
const FULL_RADIUS_THRESHOLD = 999;

/**
 * Convert camelCase to kebab-case.
 */
function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Generate CSS custom properties with light/dark theme support.
 */
export function generateCSS(tokens: ValidatedTokens): string {
  const { color, spacing, radius, iconSize } = tokens.standard;
  const lines: string[] = [HEADER, ""];

  const lightVars: string[] = [];
  const darkVars: string[] = [];

  // ColorScheme
  lightVars.push("  /* ColorScheme — light */");
  darkVars.push("  /* ColorScheme — dark */");

  for (const [key, entry] of Object.entries(color)) {
    const varName = `--color-${camelToKebab(key)}`;
    lightVars.push(`  ${varName}: ${entry.light};`);
    darkVars.push(`  ${varName}: ${entry.dark};`);
  }

  // Extensions
  for (const [, ext] of Object.entries(tokens.extensions)) {
    const prefix = ext.meta.getter;
    lightVars.push("");
    lightVars.push(`  /* Extensions — ${ext.meta.className} light */`);
    darkVars.push("");
    darkVars.push(`  /* Extensions — ${ext.meta.className} dark */`);

    for (const [fieldName, field] of Object.entries(ext.fields)) {
      const varName = `--${prefix}-${camelToKebab(fieldName)}`;
      lightVars.push(`  ${varName}: ${field.light};`);
      darkVars.push(`  ${varName}: ${field.dark};`);
    }
  }

  // Spacing
  if (Object.keys(spacing).length > 0) {
    lightVars.push("");
    lightVars.push("  /* Spacing */");
    for (const [key, value] of Object.entries(spacing)) {
      lightVars.push(`  --spacing-${camelToKebab(key)}: ${value}px;`);
    }
  }

  // Radius
  if (Object.keys(radius).length > 0) {
    lightVars.push("");
    lightVars.push("  /* Radius */");
    for (const [key, value] of Object.entries(radius)) {
      const unit = value >= FULL_RADIUS_THRESHOLD ? "" : "px";
      lightVars.push(`  --radius-${camelToKebab(key)}: ${value}${unit};`);
    }
  }

  // Icon size
  if (Object.keys(iconSize).length > 0) {
    lightVars.push("");
    lightVars.push("  /* Icon size */");
    for (const [key, value] of Object.entries(iconSize)) {
      lightVars.push(`  --icon-${camelToKebab(key)}: ${value}px;`);
    }
  }

  lines.push(":root {");
  lines.push(...lightVars);
  lines.push("}");
  lines.push("");
  lines.push('[data-theme="dark"] {');
  lines.push(...darkVars);
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate TypeScript constants for numeric tokens.
 */
export function generateTS(tokens: ValidatedTokens): string {
  const { spacing, radius, iconSize } = tokens.standard;
  const lines: string[] = [HEADER, ""];

  if (Object.keys(spacing).length > 0) {
    lines.push("export const DSSpacing = {");
    for (const [key, value] of Object.entries(spacing)) {
      lines.push(`  ${key}: ${value},`);
    }
    lines.push("} as const;");
    lines.push("");
  }

  if (Object.keys(radius).length > 0) {
    lines.push("export const DSRadius = {");
    for (const [key, value] of Object.entries(radius)) {
      lines.push(`  ${key}: ${value},`);
    }
    lines.push("} as const;");
    lines.push("");
  }

  if (Object.keys(iconSize).length > 0) {
    lines.push("export const DSIconSize = {");
    for (const [key, value] of Object.entries(iconSize)) {
      lines.push(`  ${key}: ${value},`);
    }
    lines.push("} as const;");
    lines.push("");
  }

  if (Object.keys(spacing).length > 0) {
    lines.push("export type DSSpacingKey = keyof typeof DSSpacing;");
  }
  if (Object.keys(radius).length > 0) {
    lines.push("export type DSRadiusKey = keyof typeof DSRadius;");
  }
  if (Object.keys(iconSize).length > 0) {
    lines.push("export type DSIconSizeKey = keyof typeof DSIconSize;");
  }
  lines.push("");

  return lines.join("\n");
}
