/** Default oxfmt (TypeScript formatter) options — used by init and schema generation */
export const OXFMT_DEFAULTS: Readonly<Record<string, unknown>> = {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  jsxSingleQuote: false,
  trailingComma: "all",
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: "always",
  proseWrap: "preserve",
  singleAttributePerLine: false,
  endOfLine: "lf",
};

/** Default dart format options */
export const DART_FORMAT_DEFAULTS: Readonly<Record<string, unknown>> = {
  lineLength: 80,
};

/** Default lint category levels for TypeScript */
export const LINT_CATEGORY_DEFAULTS: Readonly<Record<string, string>> = {
  correctness: "error",
  suspicious: "warn",
  perf: "warn",
};

/** Default ignore patterns for lint and format */
export const DEFAULT_IGNORE: readonly string[] = [
  "dist",
  "build",
  "**/*.g.dart",
  "**/*.freezed.dart",
  "**/*.generated.dart",
];
