import type { ValidatedTokens } from "@/plugins/builtin/domain/design/types";

const HEADER = `// GENERATED — DO NOT EDIT. Changes will be overwritten.`;

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
 * Generate ThemeExtension classes — one per custom extension section.
 * All extension fields are themed colors (light/dark pairs).
 */
export function generateThemeExtensions(tokens: ValidatedTokens): string {
  const extEntries = Object.entries(tokens.extensions);
  if (extEntries.length === 0) {
    return `${HEADER}\n\n// No extensions defined in tokens.json\n`;
  }

  const lines: string[] = [
    HEADER,
    "",
    "import 'dart:ui';",
    "",
    "import 'package:flutter/material.dart';",
    "",
  ];

  let index = 0;
  for (const [, ext] of extEntries) {
    const { className } = ext.meta;
    const fieldNames = Object.keys(ext.fields);

    lines.push("@immutable");
    lines.push(`class ${className} extends ThemeExtension<${className}> {`);

    // Constructor
    lines.push(`  const ${className}({`);
    for (const name of fieldNames) {
      lines.push(`    required this.${name},`);
    }
    lines.push("  });");
    lines.push("");

    // Fields — all Color
    for (const name of fieldNames) {
      lines.push(`  final Color ${name};`);
    }
    lines.push("");

    // Static light
    lines.push(`  static const light = ${className}(`);
    for (const name of fieldNames) {
      const field = ext.fields[name];
      if (!field) {
        continue;
      }
      lines.push(`    ${name}: ${colorToDart(field.light)},`);
    }
    lines.push("  );");
    lines.push("");

    // Static dark
    lines.push(`  static const dark = ${className}(`);
    for (const name of fieldNames) {
      const field = ext.fields[name];
      if (!field) {
        continue;
      }
      lines.push(`    ${name}: ${colorToDart(field.dark)},`);
    }
    lines.push("  );");
    lines.push("");

    // copyWith
    lines.push("  @override");
    lines.push(`  ${className} copyWith({`);
    for (const name of fieldNames) {
      lines.push(`    Color? ${name},`);
    }
    lines.push("  }) {");
    lines.push(`    return ${className}(`);
    for (const name of fieldNames) {
      lines.push(`      ${name}: ${name} ?? this.${name},`);
    }
    lines.push("    );");
    lines.push("  }");
    lines.push("");

    // lerp
    lines.push("  @override");
    lines.push(`  ${className} lerp(${className}? other, double t) {`);
    lines.push(`    if (other is! ${className}) return this;`);
    lines.push(`    return ${className}(`);
    for (const name of fieldNames) {
      lines.push(`      ${name}: Color.lerp(${name}, other.${name}, t)!,`);
    }
    lines.push("    );");
    lines.push("  }");
    lines.push("");

    // byKey — lookup by string key (useful for API-driven values like genre keys)
    const firstField = fieldNames[0] ?? "brand";
    lines.push("  /// Look up a color by its key name. Returns first color for unknown keys.");
    lines.push("  Color byKey(String key) => switch (key) {");
    for (const name of fieldNames) {
      // Convert camelCase to kebab-case for matching (e.g., sciFi → sci-fi)
      const kebab = name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
      if (kebab !== name) {
        lines.push(`    '${kebab}' || '${name}' => ${name},`);
      } else {
        lines.push(`    '${name}' => ${name},`);
      }
    }
    lines.push(`    _ => ${firstField},`);
    lines.push("  };");
    lines.push("}");

    index++;
    if (index < extEntries.length) {
      lines.push("");
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Generate the ThemeData assembly file.
 */
export function generateTheme(tokens: ValidatedTokens, packageName: string): string {
  const extEntries = Object.entries(tokens.extensions);
  const typo = tokens.standard.typography;
  const provider = typo?.provider ?? "asset";

  const lines: string[] = [HEADER, ""];

  lines.push("import 'package:flutter/material.dart';");
  if (provider === "google_fonts") {
    lines.push("import 'package:google_fonts/google_fonts.dart';");
  }
  lines.push(`import 'package:${packageName}/core/theme/generated/generated.dart';`);
  lines.push("");

  lines.push(`export 'package:${packageName}/core/theme/generated/generated.dart';`);
  lines.push("");

  // ThemeContextExtension
  lines.push("extension ThemeContextExtension on BuildContext {");
  lines.push("  ColorScheme get colorScheme => Theme.of(this).colorScheme;");
  lines.push("  TextTheme get textTheme => Theme.of(this).textTheme;");

  for (const [, ext] of extEntries) {
    const { className, getter } = ext.meta;
    lines.push(`  ${className} get ${getter} => Theme.of(this).extension<${className}>()!;`);
  }

  if (typo?.scale) {
    lines.push("");
    for (const key of Object.keys(typo.scale)) {
      lines.push(`  TextStyle get ${key} => textTheme.${key}!;`);
    }
  }

  lines.push("}");
  lines.push("");

  // ColorToHex
  lines.push("extension ColorToHex on Color {");
  lines.push("  String get hex {");
  lines.push("    final r = (this.r * 255).round().toRadixString(16).padLeft(2, '0');");
  lines.push("    final g = (this.g * 255).round().toRadixString(16).padLeft(2, '0');");
  lines.push("    final b = (this.b * 255).round().toRadixString(16).padLeft(2, '0');");
  lines.push("    return '#$r$g$b';");
  lines.push("  }");
  lines.push("}");
  lines.push("");

  // AppTheme
  lines.push("abstract final class AppTheme {");

  const extArgs = extEntries.map(([, ext]) => `    ${ext.meta.className}.light,`).join("\n");
  const extArgsDark = extEntries.map(([, ext]) => `    ${ext.meta.className}.dark,`).join("\n");

  lines.push("  static final ThemeData light = _build(");
  lines.push("    GeneratedColorScheme.light,");
  if (extArgs) {
    lines.push(extArgs);
  }
  lines.push("  );");
  lines.push("");
  lines.push("  static final ThemeData dark = _build(");
  lines.push("    GeneratedColorScheme.dark,");
  if (extArgsDark) {
    lines.push(extArgsDark);
  }
  lines.push("  );");
  lines.push("");

  const extParams = extEntries
    .map(([, ext]) => `    ${ext.meta.className} ${ext.meta.getter},`)
    .join("\n");
  lines.push("  static ThemeData _build(");
  lines.push("    ColorScheme scheme,");
  if (extParams) {
    lines.push(extParams);
  }
  lines.push("  ) {");
  lines.push("    return ThemeData(");
  lines.push("      useMaterial3: true,");
  lines.push("      brightness: scheme.brightness,");
  lines.push("      colorScheme: scheme,");
  lines.push("      scaffoldBackgroundColor: scheme.surface,");

  if (extEntries.length > 0) {
    const extList = extEntries.map(([, ext]) => ext.meta.getter).join(", ");
    lines.push(`      extensions: [${extList}],`);
  }

  if (typo?.fontFamily) {
    // Use first font family as default
    const firstFamily = Object.values(typo.fontFamily)[0];
    if (firstFamily) {
      lines.push(`      fontFamily: '${firstFamily}',`);
    }
  }

  lines.push("      textTheme: _buildTextTheme(scheme),");
  lines.push("    );");
  lines.push("  }");
  lines.push("");

  // _buildTextTheme
  lines.push("  static TextTheme _buildTextTheme(ColorScheme scheme) {");
  lines.push("    return TextTheme(");

  if (typo?.scale) {
    for (const [key, entry] of Object.entries(typo.scale)) {
      const familyName = typo.fontFamily[entry.family] ?? entry.family;
      const weightValue = typo.fontWeight[entry.weight] ?? 400;
      const dartWeight = `FontWeight.w${weightValue}`;

      let expr: string;
      if (provider === "google_fonts") {
        const methodName = familyName
          .split(" ")
          .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
          .join("");
        expr = `GoogleFonts.${methodName}(\n        fontSize: ${entry.size},\n        fontWeight: ${dartWeight},\n        color: scheme.onSurface,\n      )`;
      } else if (provider === "asset") {
        expr = `TextStyle(\n        fontFamily: '${familyName}',\n        fontSize: ${entry.size},\n        fontWeight: ${dartWeight},\n        color: scheme.onSurface,\n      )`;
      } else {
        expr = `TextStyle(\n        fontSize: ${entry.size},\n        fontWeight: ${dartWeight},\n        color: scheme.onSurface,\n      )`;
      }

      lines.push(`      ${key}: ${expr},`);
    }
  }

  lines.push("    );");
  lines.push("  }");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}
