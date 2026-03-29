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
 * Convert a font family name to a GoogleFonts method name.
 * e.g., "Playfair Display" → "playfairDisplay", "Merriweather" → "merriweather"
 */
function toGoogleFontsMethod(familyName: string): string {
  return familyName
    .split(" ")
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
}

/**
 * Generate a font style expression for the given provider.
 */
function fontStyleExpr(
  provider: string,
  familyName: string,
  opts: { readonly size: number; readonly weight: number; readonly color: string },
): string {
  if (provider === "google_fonts") {
    const method = toGoogleFontsMethod(familyName);
    return `GoogleFonts.${method}(fontSize: ${opts.size}, fontWeight: FontWeight.w${opts.weight}, color: ${opts.color})`;
  }
  if (provider === "asset") {
    return `TextStyle(fontFamily: '${familyName}', fontSize: ${opts.size}, fontWeight: FontWeight.w${opts.weight}, color: ${opts.color})`;
  }
  return `TextStyle(fontSize: ${opts.size}, fontWeight: FontWeight.w${opts.weight}, color: ${opts.color})`;
}

/**
 * Generate a short font style expression (no color — for button text styles, etc.)
 */
function fontStyleExprNoColor(
  provider: string,
  familyName: string,
  opts: { readonly size: number; readonly weight: number },
): string {
  if (provider === "google_fonts") {
    const method = toGoogleFontsMethod(familyName);
    return `GoogleFonts.${method}(fontSize: ${opts.size}, fontWeight: FontWeight.w${opts.weight})`;
  }
  if (provider === "asset") {
    return `TextStyle(fontFamily: '${familyName}', fontSize: ${opts.size}, fontWeight: FontWeight.w${opts.weight})`;
  }
  return `TextStyle(fontSize: ${opts.size}, fontWeight: FontWeight.w${opts.weight})`;
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

    // byKey
    const firstField = fieldNames[0] ?? "brand";
    lines.push("  /// Look up a color by its key name. Returns first color for unknown keys.");
    lines.push("  Color byKey(String key) => switch (key) {");
    for (const name of fieldNames) {
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
 * Generate the full ThemeData assembly file with M3 widget themes.
 */
export function generateTheme(tokens: ValidatedTokens, packageName: string): string {
  const extEntries = Object.entries(tokens.extensions);
  const typo = tokens.standard.typography;
  const provider = typo?.provider ?? "asset";

  // Resolve the "UI" font (sans/body font) for widget theme text styles
  const uiFontFamily = typo?.fontFamily["sans"] ?? typo?.fontFamily["body"] ?? Object.values(typo?.fontFamily ?? {})[0] ?? "sans-serif";
  const hasSpacing = Object.keys(tokens.standard.spacing).length > 0;
  const hasRadius = Object.keys(tokens.standard.radius).length > 0;
  const hasElevation = Object.keys(tokens.standard.elevation).length > 0;
  const hasIconSize = Object.keys(tokens.standard.iconSize).length > 0;

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
  lines.push("    return '#\$r\$g\$b';");
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
    lines.push(`      fontFamily: '${uiFontFamily}',`);
  }

  lines.push("      textTheme: _buildTextTheme(scheme),");
  lines.push("");

  // ─── M3 Widget Themes ──────────────────────────────────────────────────

  // AppBarTheme
  lines.push("      // AppBar");
  lines.push("      appBarTheme: AppBarTheme(");
  if (hasElevation) {
    lines.push("        elevation: DSElevation.none,");
    lines.push("        scrolledUnderElevation: DSElevation.lg,");
  }
  lines.push("        backgroundColor: scheme.surface,");
  lines.push("        foregroundColor: scheme.onSurface,");
  lines.push("        surfaceTintColor: scheme.surfaceTint,");
  lines.push("        centerTitle: true,");
  lines.push(`        titleTextStyle: ${fontStyleExpr(provider, uiFontFamily, { size: 22, weight: 600, color: "scheme.onSurface" })},`);
  if (hasIconSize) {
    lines.push("        iconTheme: IconThemeData(size: DSIconSize.md),");
  }
  lines.push("      ),");
  lines.push("");

  // BottomSheetTheme
  lines.push("      // BottomSheet");
  lines.push("      bottomSheetTheme: BottomSheetThemeData(");
  lines.push("        backgroundColor: scheme.surface,");
  lines.push("        modalBackgroundColor: scheme.surface,");
  if (hasElevation) {
    lines.push("        elevation: DSElevation.none,");
    lines.push("        modalElevation: DSElevation.none,");
  }
  if (hasRadius) {
    lines.push("        shape: const RoundedRectangleBorder(");
    lines.push("          borderRadius: BorderRadius.vertical(top: Radius.circular(DSRadius.xl)),");
    lines.push("        ),");
  }
  lines.push("        surfaceTintColor: Colors.transparent,");
  lines.push("        showDragHandle: true,");
  lines.push("        dragHandleColor: scheme.onSurfaceVariant.withValues(alpha: 0.4),");
  lines.push("        dragHandleSize: const Size(32, 4),");
  lines.push("      ),");
  lines.push("");

  // DialogTheme
  lines.push("      // Dialog");
  lines.push("      dialogTheme: DialogThemeData(");
  lines.push("        backgroundColor: scheme.surfaceContainerHigh,");
  if (hasElevation) {
    lines.push("        elevation: DSElevation.xxl,");
  }
  if (hasRadius) {
    lines.push("        shape: RoundedRectangleBorder(borderRadius: DSRadius.xlAll),");
  }
  lines.push("        surfaceTintColor: scheme.surfaceTint,");
  lines.push("      ),");
  lines.push("");

  // CardTheme
  lines.push("      // Card");
  lines.push("      cardTheme: CardThemeData(");
  if (hasElevation) {
    lines.push("        elevation: DSElevation.sm,");
  }
  lines.push("        color: scheme.surfaceContainerLow,");
  lines.push("        surfaceTintColor: scheme.surfaceTint,");
  if (hasRadius) {
    lines.push("        shape: RoundedRectangleBorder(");
    lines.push("          borderRadius: DSRadius.lgAll,");
    lines.push("          side: BorderSide(color: scheme.outlineVariant),");
    lines.push("        ),");
  }
  lines.push("        margin: EdgeInsets.zero,");
  lines.push("      ),");
  lines.push("");

  // FilledButton
  const btnTextStyle = fontStyleExprNoColor(provider, uiFontFamily, { size: 14, weight: 600 });
  lines.push("      // Buttons");
  lines.push("      filledButtonTheme: FilledButtonThemeData(");
  lines.push("        style: FilledButton.styleFrom(");
  if (hasElevation) {
    lines.push("          elevation: DSElevation.none,");
  }
  if (hasRadius) {
    lines.push("          shape: RoundedRectangleBorder(borderRadius: DSRadius.mdAll),");
  }
  if (hasSpacing) {
    lines.push("          padding: const EdgeInsets.symmetric(horizontal: DSSpacing.lg, vertical: DSSpacing.md),");
  }
  lines.push("          minimumSize: const Size(64, 48),");
  lines.push(`          textStyle: ${btnTextStyle},`);
  lines.push("        ),");
  lines.push("      ),");

  // ElevatedButton
  lines.push("      elevatedButtonTheme: ElevatedButtonThemeData(");
  lines.push("        style: ElevatedButton.styleFrom(");
  if (hasElevation) {
    lines.push("          elevation: DSElevation.sm,");
  }
  if (hasRadius) {
    lines.push("          shape: RoundedRectangleBorder(borderRadius: DSRadius.mdAll),");
  }
  lines.push("          backgroundColor: scheme.surfaceContainerLow,");
  lines.push("          foregroundColor: scheme.primary,");
  if (hasSpacing) {
    lines.push("          padding: const EdgeInsets.symmetric(horizontal: DSSpacing.lg, vertical: DSSpacing.md),");
  }
  lines.push("          minimumSize: const Size(64, 48),");
  lines.push(`          textStyle: ${btnTextStyle},`);
  lines.push("        ),");
  lines.push("      ),");

  // OutlinedButton
  lines.push("      outlinedButtonTheme: OutlinedButtonThemeData(");
  lines.push("        style: OutlinedButton.styleFrom(");
  if (hasElevation) {
    lines.push("          elevation: DSElevation.none,");
  }
  if (hasRadius) {
    lines.push("          shape: RoundedRectangleBorder(borderRadius: DSRadius.mdAll),");
  }
  lines.push("          side: BorderSide(color: scheme.outline),");
  if (hasSpacing) {
    lines.push("          padding: const EdgeInsets.symmetric(horizontal: DSSpacing.lg, vertical: DSSpacing.md),");
  }
  lines.push("          minimumSize: const Size(64, 48),");
  lines.push(`          textStyle: ${btnTextStyle},`);
  lines.push("        ),");
  lines.push("      ),");

  // TextButton
  lines.push("      textButtonTheme: TextButtonThemeData(");
  lines.push("        style: TextButton.styleFrom(");
  if (hasRadius) {
    lines.push("          shape: RoundedRectangleBorder(borderRadius: DSRadius.mdAll),");
  }
  if (hasSpacing) {
    lines.push("          padding: const EdgeInsets.symmetric(horizontal: DSSpacing.base, vertical: DSSpacing.md),");
  }
  lines.push("          minimumSize: const Size(64, 48),");
  lines.push(`          textStyle: ${btnTextStyle},`);
  lines.push("        ),");
  lines.push("      ),");

  // IconButton
  lines.push("      iconButtonTheme: IconButtonThemeData(");
  lines.push("        style: IconButton.styleFrom(");
  lines.push("          minimumSize: const Size(48, 48),");
  if (hasIconSize) {
    lines.push("          iconSize: DSIconSize.md,");
  }
  lines.push("        ),");
  lines.push("      ),");
  lines.push("");

  // FAB
  lines.push("      // FAB");
  lines.push("      floatingActionButtonTheme: FloatingActionButtonThemeData(");
  if (hasElevation) {
    lines.push("        elevation: DSElevation.lg,");
    lines.push("        highlightElevation: DSElevation.xl,");
  }
  lines.push("        backgroundColor: scheme.primaryContainer,");
  lines.push("        foregroundColor: scheme.onPrimaryContainer,");
  if (hasRadius) {
    lines.push("        shape: RoundedRectangleBorder(borderRadius: DSRadius.lgAll),");
  }
  lines.push("      ),");
  lines.push("");

  // InputDecoration
  lines.push("      // Input");
  lines.push("      inputDecorationTheme: InputDecorationTheme(");
  lines.push("        filled: true,");
  lines.push("        fillColor: scheme.surfaceContainerHighest,");
  if (hasRadius) {
    lines.push("        border: OutlineInputBorder(borderRadius: DSRadius.mdAll, borderSide: BorderSide(color: scheme.outline)),");
    lines.push("        enabledBorder: OutlineInputBorder(borderRadius: DSRadius.mdAll, borderSide: BorderSide(color: scheme.outline)),");
    lines.push("        focusedBorder: OutlineInputBorder(borderRadius: DSRadius.mdAll, borderSide: BorderSide(color: scheme.primary, width: 2)),");
    lines.push("        errorBorder: OutlineInputBorder(borderRadius: DSRadius.mdAll, borderSide: BorderSide(color: scheme.error)),");
    lines.push("        focusedErrorBorder: OutlineInputBorder(borderRadius: DSRadius.mdAll, borderSide: BorderSide(color: scheme.error, width: 2)),");
  }
  if (hasSpacing) {
    lines.push("        contentPadding: const EdgeInsets.symmetric(horizontal: DSSpacing.base, vertical: DSSpacing.md),");
  }
  lines.push("      ),");
  lines.push("");

  // Chip
  lines.push("      // Chip");
  lines.push("      chipTheme: ChipThemeData(");
  if (hasElevation) {
    lines.push("        elevation: DSElevation.none,");
  }
  lines.push("        backgroundColor: scheme.surfaceContainerLow,");
  lines.push("        selectedColor: scheme.secondaryContainer,");
  if (hasRadius) {
    lines.push("        shape: RoundedRectangleBorder(borderRadius: DSRadius.fullAll),");
  }
  lines.push("        side: BorderSide(color: scheme.outlineVariant),");
  if (hasSpacing) {
    lines.push("        padding: const EdgeInsets.symmetric(horizontal: DSSpacing.sm),");
  }
  lines.push("      ),");
  lines.push("");

  // SnackBar
  lines.push("      // SnackBar");
  lines.push("      snackBarTheme: SnackBarThemeData(");
  lines.push("        backgroundColor: scheme.inverseSurface,");
  lines.push("        actionTextColor: scheme.inversePrimary,");
  if (hasElevation) {
    lines.push("        elevation: DSElevation.lg,");
  }
  if (hasRadius) {
    lines.push("        shape: RoundedRectangleBorder(borderRadius: DSRadius.mdAll),");
  }
  lines.push("        behavior: SnackBarBehavior.floating,");
  if (hasSpacing) {
    lines.push("        insetPadding: const EdgeInsets.symmetric(horizontal: DSSpacing.base, vertical: DSSpacing.sm),");
  }
  lines.push("      ),");
  lines.push("");

  // Tooltip
  lines.push("      // Tooltip");
  lines.push("      tooltipTheme: TooltipThemeData(");
  if (hasRadius) {
    lines.push("        decoration: BoxDecoration(color: scheme.inverseSurface, borderRadius: DSRadius.mdAll),");
  }
  if (hasSpacing) {
    lines.push("        padding: const EdgeInsets.symmetric(horizontal: DSSpacing.sm, vertical: DSSpacing.xs),");
  }
  lines.push("      ),");
  lines.push("");

  // PopupMenu
  lines.push("      // PopupMenu");
  lines.push("      popupMenuTheme: PopupMenuThemeData(");
  if (hasElevation) {
    lines.push("        elevation: DSElevation.xxl,");
  }
  lines.push("        color: scheme.surfaceContainer,");
  if (hasRadius) {
    lines.push("        shape: RoundedRectangleBorder(borderRadius: DSRadius.mdAll),");
  }
  lines.push("        surfaceTintColor: scheme.surfaceTint,");
  lines.push("      ),");
  lines.push("");

  // NavigationBar
  lines.push("      // NavigationBar");
  lines.push("      navigationBarTheme: NavigationBarThemeData(");
  if (hasElevation) {
    lines.push("        elevation: DSElevation.md,");
  }
  lines.push("        backgroundColor: scheme.surfaceContainer,");
  lines.push("        surfaceTintColor: scheme.surfaceTint,");
  lines.push("        indicatorColor: scheme.secondaryContainer,");
  if (hasRadius) {
    lines.push("        indicatorShape: RoundedRectangleBorder(borderRadius: DSRadius.fullAll),");
  }
  lines.push("        height: 80,");
  lines.push("        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,");
  lines.push("      ),");
  lines.push("");

  // TabBar
  lines.push("      // TabBar");
  lines.push("      tabBarTheme: TabBarThemeData(");
  lines.push("        labelColor: scheme.primary,");
  lines.push("        unselectedLabelColor: scheme.onSurfaceVariant,");
  lines.push("        indicatorColor: scheme.primary,");
  lines.push("        indicatorSize: TabBarIndicatorSize.label,");
  lines.push(`        labelStyle: ${fontStyleExprNoColor(provider, uiFontFamily, { size: 14, weight: 600 })},`);
  lines.push(`        unselectedLabelStyle: ${fontStyleExprNoColor(provider, uiFontFamily, { size: 14, weight: 400 })},`);
  lines.push("      ),");
  lines.push("");

  // Divider
  lines.push("      // Divider");
  lines.push("      dividerTheme: DividerThemeData(color: scheme.outlineVariant, thickness: 1, space: 0),");
  lines.push("");

  // Progress
  lines.push("      // Progress");
  lines.push("      progressIndicatorTheme: ProgressIndicatorThemeData(");
  lines.push("        color: scheme.primary,");
  lines.push("        linearTrackColor: scheme.surfaceContainerHighest,");
  lines.push("        circularTrackColor: scheme.surfaceContainerHighest,");
  lines.push("      ),");
  lines.push("");

  // Switch
  lines.push("      // Switch");
  lines.push("      switchTheme: SwitchThemeData(");
  lines.push("        thumbColor: WidgetStateProperty.resolveWith((states) {");
  lines.push("          if (states.contains(WidgetState.selected)) return scheme.onPrimary;");
  lines.push("          return scheme.outline;");
  lines.push("        }),");
  lines.push("        trackColor: WidgetStateProperty.resolveWith((states) {");
  lines.push("          if (states.contains(WidgetState.selected)) return scheme.primary;");
  lines.push("          return scheme.surfaceContainerHighest;");
  lines.push("        }),");
  lines.push("        trackOutlineColor: WidgetStateProperty.resolveWith((states) {");
  lines.push("          if (states.contains(WidgetState.selected)) return Colors.transparent;");
  lines.push("          return scheme.outline;");
  lines.push("        }),");
  lines.push("      ),");
  lines.push("");

  // Checkbox
  lines.push("      // Checkbox");
  lines.push("      checkboxTheme: CheckboxThemeData(");
  lines.push("        fillColor: WidgetStateProperty.resolveWith((states) {");
  lines.push("          if (states.contains(WidgetState.selected)) return scheme.primary;");
  lines.push("          return Colors.transparent;");
  lines.push("        }),");
  lines.push("        checkColor: WidgetStateProperty.all(scheme.onPrimary),");
  lines.push("        side: BorderSide(color: scheme.onSurfaceVariant, width: 2),");
  if (hasRadius) {
    lines.push("        shape: RoundedRectangleBorder(borderRadius: DSRadius.smAll),");
  }
  lines.push("      ),");
  lines.push("");

  // Radio
  lines.push("      // Radio");
  lines.push("      radioTheme: RadioThemeData(");
  lines.push("        fillColor: WidgetStateProperty.resolveWith((states) {");
  lines.push("          if (states.contains(WidgetState.selected)) return scheme.primary;");
  lines.push("          return scheme.onSurfaceVariant;");
  lines.push("        }),");
  lines.push("      ),");
  lines.push("");

  // Slider
  lines.push("      // Slider");
  lines.push("      sliderTheme: SliderThemeData(");
  lines.push("        activeTrackColor: scheme.primary,");
  lines.push("        inactiveTrackColor: scheme.surfaceContainerHighest,");
  lines.push("        thumbColor: scheme.primary,");
  lines.push("        overlayColor: scheme.primary.withValues(alpha: 0.12),");
  lines.push("      ),");
  lines.push("");

  // ListTile
  lines.push("      // ListTile");
  lines.push("      listTileTheme: ListTileThemeData(");
  if (hasSpacing) {
    lines.push("        contentPadding: const EdgeInsets.symmetric(horizontal: DSSpacing.base),");
    lines.push("        minVerticalPadding: DSSpacing.md,");
  }
  lines.push("        iconColor: scheme.onSurfaceVariant,");
  lines.push("        textColor: scheme.onSurface,");
  if (hasRadius) {
    lines.push("        shape: RoundedRectangleBorder(borderRadius: DSRadius.mdAll),");
  }
  lines.push("      ),");
  lines.push("");

  // Icon
  if (hasIconSize) {
    lines.push("      // Icon");
    lines.push("      iconTheme: IconThemeData(size: DSIconSize.md),");
    lines.push("");
  }

  // Scrollbar
  lines.push("      // Scrollbar");
  lines.push("      scrollbarTheme: ScrollbarThemeData(");
  lines.push("        thumbColor: WidgetStateProperty.all(scheme.onSurface.withValues(alpha: 0.3)),");
  if (hasRadius) {
    lines.push("        radius: const Radius.circular(DSRadius.full),");
  }
  lines.push("        thickness: WidgetStateProperty.all(4),");
  lines.push("      ),");
  lines.push("");

  // Badge
  lines.push("      // Badge");
  lines.push("      badgeTheme: BadgeThemeData(");
  lines.push("        backgroundColor: scheme.error,");
  lines.push("        textColor: scheme.onError,");
  lines.push("      ),");
  lines.push("");

  // SearchBar
  lines.push("      // SearchBar");
  lines.push("      searchBarTheme: SearchBarThemeData(");
  if (hasElevation) {
    lines.push("        elevation: WidgetStateProperty.all(DSElevation.sm),");
  }
  lines.push("        backgroundColor: WidgetStateProperty.all(scheme.surfaceContainerHigh),");
  lines.push("        surfaceTintColor: WidgetStateProperty.all(scheme.surfaceTint),");
  if (hasRadius) {
    lines.push("        shape: WidgetStateProperty.all(RoundedRectangleBorder(borderRadius: DSRadius.fullAll)),");
  }
  if (hasSpacing) {
    lines.push("        padding: WidgetStateProperty.all(const EdgeInsets.symmetric(horizontal: DSSpacing.base)),");
  }
  lines.push("      ),");
  lines.push("");

  // BottomNavigationBar
  lines.push("      // BottomNavigationBar");
  lines.push("      bottomNavigationBarTheme: BottomNavigationBarThemeData(");
  lines.push("        backgroundColor: scheme.surfaceContainer,");
  lines.push("        selectedItemColor: scheme.primary,");
  lines.push("        unselectedItemColor: scheme.onSurfaceVariant,");
  if (hasElevation) {
    lines.push("        elevation: DSElevation.md,");
  }
  lines.push("        type: BottomNavigationBarType.fixed,");
  lines.push("      ),");

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
      // bodySmall and labelSmall use onSurfaceVariant in M3
      const color = key === "bodySmall" || key === "labelSmall" ? "scheme.onSurfaceVariant" : "scheme.onSurface";
      const expr = fontStyleExpr(provider, familyName, { size: entry.size, weight: weightValue, color });
      lines.push(`      ${key}: ${expr},`);
    }
  }

  lines.push("    );");
  lines.push("  }");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}
