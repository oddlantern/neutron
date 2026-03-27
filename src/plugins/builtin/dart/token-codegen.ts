import type { ValidatedTokens } from "../design/types.js";

// Re-export theme functions so existing imports from this module still work
export { generateThemeExtensions, generateTheme } from "./token-theme.js";

const HEADER = `// GENERATED — DO NOT EDIT. Changes will be overwritten.`;

/**
 * Expand 3-char hex (#RGB) → 6-char (#RRGGBB).
 * Returns the input unchanged if not a 3-char hex.
 */
function expandShortHex(hex: string): string {
  if (hex.length === 3) {
    return `${hex.charAt(0)}${hex.charAt(0)}${hex.charAt(1)}${hex.charAt(1)}${hex.charAt(2)}${hex.charAt(2)}`;
  }
  return hex;
}

/**
 * Convert a color value string to a Dart Color constructor.
 * Supports #RGB, #RRGGBB, #RRGGBBAA hex, rgb(a)(), and hsl(a)() colors.
 */
function colorToDart(value: string): string {
  // Hex color (#RGB, #RRGGBB, #RRGGBBAA)
  if (value.startsWith("#")) {
    const raw = value.slice(1).toUpperCase();
    const expanded = expandShortHex(raw);

    // #RRGGBBAA — alpha channel
    if (expanded.length === 8) {
      const rgb = expanded.slice(0, 6);
      const alpha = expanded.slice(6, 8);
      return `Color(0x${alpha}${rgb})`;
    }

    return `Color(0xFF${expanded})`;
  }

  // rgba() / rgb() — parse into Color.fromRGBO
  const rgbaMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(
    value,
  );
  if (rgbaMatch) {
    const r = rgbaMatch[1];
    const g = rgbaMatch[2];
    const b = rgbaMatch[3];
    const a = rgbaMatch[4] ?? "1.0";
    return `Color.fromRGBO(${r}, ${g}, ${b}, ${a})`;
  }

  // hsla() / hsl() — parse into HSLColor then convert
  const hslMatch =
    /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*(?:,\s*([\d.]+))?\s*\)$/.exec(
      value,
    );
  if (hslMatch) {
    const h = hslMatch[1];
    const s = hslMatch[2];
    const l = hslMatch[3];
    const a = hslMatch[4] ?? "1.0";
    return `HSLColor.fromAHSL(${a}, ${h}, ${Number(s) / 100}, ${Number(l) / 100}).toColor()`;
  }

  // Fallback — raw string (should not happen with validated tokens)
  return `Color(0xFF000000) /* unrecognized: ${value} */`;
}

/**
 * Encode a color with a separate opacity into a Dart Color.
 * For hex colors, bakes the alpha into 0xAARRGGBB directly.
 * For other formats, applies .withValues(alpha:) on the converted color.
 */
function shadowToDartColor(color: string, opacity: number): string {
  if (color.startsWith("#")) {
    const raw = color.slice(1).toUpperCase();
    const clean = expandShortHex(raw).slice(0, 6);
    const alpha = Math.round(opacity * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
    return `Color(0x${alpha}${clean})`;
  }
  // For non-hex colors, convert first then apply opacity
  return `${colorToDart(color)}.withValues(alpha: ${opacity})`;
}

// ─── M3 ColorScheme fields (Flutter 3.18+) ─────────────────────────────────

const COLOR_SCHEME_FIELDS: readonly string[] = [
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "primaryFixed",
  "primaryFixedDim",
  "onPrimaryFixed",
  "onPrimaryFixedVariant",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "secondaryFixed",
  "secondaryFixedDim",
  "onSecondaryFixed",
  "onSecondaryFixedVariant",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "tertiaryFixed",
  "tertiaryFixedDim",
  "onTertiaryFixed",
  "onTertiaryFixedVariant",
  "surface",
  "onSurface",
  "onSurfaceVariant",
  "surfaceDim",
  "surfaceBright",
  "surfaceTint",
  "surfaceContainerLowest",
  "surfaceContainerLow",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
  "outline",
  "outlineVariant",
  "inverseSurface",
  "onInverseSurface",
  "inversePrimary",
  "shadow",
  "scrim",
];

// ─── Generators ────────────────────────────────────────────────────────────

/**
 * Generate the M3 ColorScheme Dart file.
 */
export function generateColorScheme(tokens: ValidatedTokens): string {
  const { color } = tokens.standard;
  const lines: string[] = [HEADER, "", "import 'package:flutter/material.dart';", ""];

  lines.push("abstract final class GeneratedColorScheme {");

  for (const mode of ["light", "dark"] as const) {
    lines.push(`  static ColorScheme get ${mode} => const ColorScheme.${mode}(`);

    for (const field of COLOR_SCHEME_FIELDS) {
      const entry = color[field];
      if (!entry) {
        continue;
      }
      lines.push(`    ${field}: ${colorToDart(entry[mode])},`);
    }

    lines.push("  );");
    if (mode === "light") {
      lines.push("");
    }
  }

  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

/**
 * Generate constants: DSSpacing, DSRadius, DSElevation, DSIconSize, DSShadow.
 */
export function generateConstants(tokens: ValidatedTokens): string {
  const { spacing, radius, elevation, shadowCard, iconSize } = tokens.standard;
  const lines: string[] = [HEADER, "", "import 'package:flutter/material.dart';", ""];

  // DSSpacing
  if (Object.keys(spacing).length > 0) {
    lines.push("abstract final class DSSpacing {");
    for (const [key, value] of Object.entries(spacing)) {
      lines.push(`  static const double ${key} = ${value};`);
    }
    lines.push("}");
    lines.push("");
  }

  // DSRadius
  if (Object.keys(radius).length > 0) {
    lines.push("abstract final class DSRadius {");
    for (const [key, value] of Object.entries(radius)) {
      lines.push(`  static const double ${key} = ${value};`);
    }
    lines.push("");
    lines.push("  // Convenience BorderRadius constructors");
    for (const [key, value] of Object.entries(radius)) {
      if (value <= 0) {
        continue;
      }
      lines.push(
        `  static const BorderRadius ${key}All = BorderRadius.all(Radius.circular(${key}));`,
      );
    }
    lines.push("}");
    lines.push("");
  }

  // DSElevation
  if (Object.keys(elevation).length > 0) {
    lines.push("abstract final class DSElevation {");
    for (const [key, entry] of Object.entries(elevation)) {
      lines.push(`  static const double ${key} = ${entry.dp};`);
    }
    lines.push("}");
    lines.push("");
  }

  // DSIconSize
  if (Object.keys(iconSize).length > 0) {
    lines.push("abstract final class DSIconSize {");
    for (const [key, value] of Object.entries(iconSize)) {
      lines.push(`  static const double ${key} = ${value};`);
    }
    lines.push("}");
    lines.push("");
  }

  // DSShadow (light) + DSShadowDark (dark)
  if (Object.keys(elevation).length > 0) {
    for (const mode of ["light", "dark"] as const) {
      const clsName = mode === "light" ? "DSShadow" : "DSShadowDark";
      lines.push(`abstract final class ${clsName} {`);

      if (shadowCard) {
        const shadows = shadowCard[mode];
        lines.push("  static const List<BoxShadow> card = [");
        for (const s of shadows) {
          lines.push("    BoxShadow(");
          lines.push(`      offset: Offset(${s.x}, ${s.y}),`);
          lines.push(`      blurRadius: ${s.blur},`);
          lines.push(`      spreadRadius: ${s.spread},`);
          lines.push(`      color: ${shadowToDartColor(s.color, s.opacity)},`);
          lines.push("    ),");
        }
        lines.push("  ];");
        lines.push("");
      }

      for (const [key, entry] of Object.entries(elevation)) {
        const shadows = entry.shadow[mode];
        lines.push(`  static const List<BoxShadow> ${key} = [`);
        for (const s of shadows) {
          lines.push("    BoxShadow(");
          lines.push(`      offset: Offset(${s.x}, ${s.y}),`);
          lines.push(`      blurRadius: ${s.blur},`);
          lines.push(`      spreadRadius: ${s.spread},`);
          lines.push(`      color: ${shadowToDartColor(s.color, s.opacity)},`);
          lines.push("    ),");
        }
        lines.push("  ];");
      }

      lines.push("}");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Generate a barrel file that re-exports all generated files.
 */
export function generateBarrel(fileNames: readonly string[]): string {
  const lines: string[] = [HEADER, ""];
  for (const name of fileNames) {
    lines.push(`export '${name}';`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Generate the top-level package barrel file.
 */
export function generatePackageBarrel(_packageName: string): string {
  const lines: string[] = [HEADER, ""];
  lines.push("export 'core/theme/theme.dart';");
  lines.push("");
  return lines.join("\n");
}
