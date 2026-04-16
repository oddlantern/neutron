import { z } from "zod";

//#region src/config/schema.d.ts
declare const ecosystemSchema: z.ZodObject<{
  manifest: z.ZodString;
  lockfile: z.ZodOptional<z.ZodString>;
  packages: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
  manifest: string;
  packages: string[];
  lockfile?: string | undefined;
}, {
  manifest: string;
  packages: string[];
  lockfile?: string | undefined;
}>;
/** Supported design token output formats (autocomplete via JSON schema). */
declare const DESIGN_FORMATS: readonly ["css", "tailwind", "material3", "bootstrap", "tokens"];
declare const bridgeSchema: z.ZodEffects<z.ZodObject<{
  source: z.ZodString;
  artifact: z.ZodString;
  consumers: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodObject<{
    path: z.ZodString;
    format: z.ZodOptional<z.ZodEnum<["css", "tailwind", "material3", "bootstrap", "tokens"]>>;
  }, "strip", z.ZodTypeAny, {
    path: string;
    format?: "css" | "tailwind" | "material3" | "bootstrap" | "tokens" | undefined;
  }, {
    path: string;
    format?: "css" | "tailwind" | "material3" | "bootstrap" | "tokens" | undefined;
  }>]>, "many">>;
  /** @deprecated since v0.4.0. Use `consumers` instead. Auto-migrated on load. */
  target: z.ZodOptional<z.ZodString>;
  run: z.ZodOptional<z.ZodString>;
  watch: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
  entryFile: z.ZodOptional<z.ZodString>;
  specPath: z.ZodOptional<z.ZodString>;
  /** Path prefixes to exclude from generated output */
  exclude: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
  source: string;
  artifact: string;
  consumers?: (string | {
    path: string;
    format?: "css" | "tailwind" | "material3" | "bootstrap" | "tokens" | undefined;
  })[] | undefined;
  target?: string | undefined;
  run?: string | undefined;
  watch?: string[] | undefined;
  entryFile?: string | undefined;
  specPath?: string | undefined;
  exclude?: string[] | undefined;
}, {
  source: string;
  artifact: string;
  consumers?: (string | {
    path: string;
    format?: "css" | "tailwind" | "material3" | "bootstrap" | "tokens" | undefined;
  })[] | undefined;
  target?: string | undefined;
  run?: string | undefined;
  watch?: string[] | undefined;
  entryFile?: string | undefined;
  specPath?: string | undefined;
  exclude?: string[] | undefined;
}>, {
  source: string;
  artifact: string;
  consumers?: (string | {
    path: string;
    format?: "css" | "tailwind" | "material3" | "bootstrap" | "tokens" | undefined;
  })[] | undefined;
  target?: string | undefined;
  run?: string | undefined;
  watch?: string[] | undefined;
  entryFile?: string | undefined;
  specPath?: string | undefined;
  exclude?: string[] | undefined;
}, {
  source: string;
  artifact: string;
  consumers?: (string | {
    path: string;
    format?: "css" | "tailwind" | "material3" | "bootstrap" | "tokens" | undefined;
  })[] | undefined;
  target?: string | undefined;
  run?: string | undefined;
  watch?: string[] | undefined;
  entryFile?: string | undefined;
  specPath?: string | undefined;
  exclude?: string[] | undefined;
}>;
declare const envSchema: z.ZodObject<{
  shared: z.ZodArray<z.ZodString, "many">;
  files: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
  shared: string[];
  files: string[];
}, {
  shared: string[];
  files: string[];
}>;
declare const DEFAULT_COMMIT_TYPES: readonly ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"];
declare const commitsSchema: z.ZodObject<{
  types: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
  scopes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
  header_max_length: z.ZodDefault<z.ZodNumber>;
  body_max_line_length: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
  types: string[];
  header_max_length: number;
  body_max_line_length: number;
  scopes?: string[] | undefined;
}, {
  types?: string[] | undefined;
  scopes?: string[] | undefined;
  header_max_length?: number | undefined;
  body_max_line_length?: number | undefined;
}>;
declare const formatTypescriptSchema: z.ZodObject<{
  printWidth: z.ZodOptional<z.ZodNumber>;
  tabWidth: z.ZodOptional<z.ZodNumber>;
  useTabs: z.ZodOptional<z.ZodBoolean>;
  semi: z.ZodOptional<z.ZodBoolean>;
  singleQuote: z.ZodOptional<z.ZodBoolean>;
  jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
  trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
  bracketSpacing: z.ZodOptional<z.ZodBoolean>;
  bracketSameLine: z.ZodOptional<z.ZodBoolean>;
  arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
  proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
  singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
  endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
  printWidth: z.ZodOptional<z.ZodNumber>;
  tabWidth: z.ZodOptional<z.ZodNumber>;
  useTabs: z.ZodOptional<z.ZodBoolean>;
  semi: z.ZodOptional<z.ZodBoolean>;
  singleQuote: z.ZodOptional<z.ZodBoolean>;
  jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
  trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
  bracketSpacing: z.ZodOptional<z.ZodBoolean>;
  bracketSameLine: z.ZodOptional<z.ZodBoolean>;
  arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
  proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
  singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
  endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
  printWidth: z.ZodOptional<z.ZodNumber>;
  tabWidth: z.ZodOptional<z.ZodNumber>;
  useTabs: z.ZodOptional<z.ZodBoolean>;
  semi: z.ZodOptional<z.ZodBoolean>;
  singleQuote: z.ZodOptional<z.ZodBoolean>;
  jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
  trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
  bracketSpacing: z.ZodOptional<z.ZodBoolean>;
  bracketSameLine: z.ZodOptional<z.ZodBoolean>;
  arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
  proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
  singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
  endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
}, z.ZodTypeAny, "passthrough">>;
declare const formatDartSchema: z.ZodObject<{
  lineLength: z.ZodOptional<z.ZodNumber>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
  lineLength: z.ZodOptional<z.ZodNumber>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
  lineLength: z.ZodOptional<z.ZodNumber>;
}, z.ZodTypeAny, "passthrough">>;
declare const formatPythonSchema: z.ZodObject<{
  lineLength: z.ZodOptional<z.ZodNumber>;
  indentWidth: z.ZodOptional<z.ZodNumber>;
  quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
  lineLength: z.ZodOptional<z.ZodNumber>;
  indentWidth: z.ZodOptional<z.ZodNumber>;
  quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
  lineLength: z.ZodOptional<z.ZodNumber>;
  indentWidth: z.ZodOptional<z.ZodNumber>;
  quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
}, z.ZodTypeAny, "passthrough">>;
declare const formatRustSchema: z.ZodObject<{
  edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
  maxWidth: z.ZodOptional<z.ZodNumber>;
  tabSpaces: z.ZodOptional<z.ZodNumber>;
  useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
  edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
  maxWidth: z.ZodOptional<z.ZodNumber>;
  tabSpaces: z.ZodOptional<z.ZodNumber>;
  useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
  edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
  maxWidth: z.ZodOptional<z.ZodNumber>;
  tabSpaces: z.ZodOptional<z.ZodNumber>;
  useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
}, z.ZodTypeAny, "passthrough">>;
declare const formatGoSchema: z.ZodObject<{
  simplify: z.ZodOptional<z.ZodBoolean>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
  simplify: z.ZodOptional<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
  simplify: z.ZodOptional<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">>;
declare const formatPhpSchema: z.ZodObject<{
  rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
  rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
  rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
}, z.ZodTypeAny, "passthrough">>;
declare const formatSchema: z.ZodObject<{
  ignore: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
  typescript: z.ZodOptional<z.ZodObject<{
    printWidth: z.ZodOptional<z.ZodNumber>;
    tabWidth: z.ZodOptional<z.ZodNumber>;
    useTabs: z.ZodOptional<z.ZodBoolean>;
    semi: z.ZodOptional<z.ZodBoolean>;
    singleQuote: z.ZodOptional<z.ZodBoolean>;
    jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
    trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
    bracketSpacing: z.ZodOptional<z.ZodBoolean>;
    bracketSameLine: z.ZodOptional<z.ZodBoolean>;
    arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
    proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
    singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
    endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
  }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    printWidth: z.ZodOptional<z.ZodNumber>;
    tabWidth: z.ZodOptional<z.ZodNumber>;
    useTabs: z.ZodOptional<z.ZodBoolean>;
    semi: z.ZodOptional<z.ZodBoolean>;
    singleQuote: z.ZodOptional<z.ZodBoolean>;
    jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
    trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
    bracketSpacing: z.ZodOptional<z.ZodBoolean>;
    bracketSameLine: z.ZodOptional<z.ZodBoolean>;
    arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
    proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
    singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
    endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
  }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    printWidth: z.ZodOptional<z.ZodNumber>;
    tabWidth: z.ZodOptional<z.ZodNumber>;
    useTabs: z.ZodOptional<z.ZodBoolean>;
    semi: z.ZodOptional<z.ZodBoolean>;
    singleQuote: z.ZodOptional<z.ZodBoolean>;
    jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
    trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
    bracketSpacing: z.ZodOptional<z.ZodBoolean>;
    bracketSameLine: z.ZodOptional<z.ZodBoolean>;
    arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
    proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
    singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
    endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
  }, z.ZodTypeAny, "passthrough">>>;
  dart: z.ZodOptional<z.ZodObject<{
    lineLength: z.ZodOptional<z.ZodNumber>;
  }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    lineLength: z.ZodOptional<z.ZodNumber>;
  }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    lineLength: z.ZodOptional<z.ZodNumber>;
  }, z.ZodTypeAny, "passthrough">>>;
  python: z.ZodOptional<z.ZodObject<{
    lineLength: z.ZodOptional<z.ZodNumber>;
    indentWidth: z.ZodOptional<z.ZodNumber>;
    quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
  }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    lineLength: z.ZodOptional<z.ZodNumber>;
    indentWidth: z.ZodOptional<z.ZodNumber>;
    quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
  }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    lineLength: z.ZodOptional<z.ZodNumber>;
    indentWidth: z.ZodOptional<z.ZodNumber>;
    quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
  }, z.ZodTypeAny, "passthrough">>>;
  rust: z.ZodOptional<z.ZodObject<{
    edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
    maxWidth: z.ZodOptional<z.ZodNumber>;
    tabSpaces: z.ZodOptional<z.ZodNumber>;
    useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
  }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
    maxWidth: z.ZodOptional<z.ZodNumber>;
    tabSpaces: z.ZodOptional<z.ZodNumber>;
    useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
  }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
    maxWidth: z.ZodOptional<z.ZodNumber>;
    tabSpaces: z.ZodOptional<z.ZodNumber>;
    useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
  }, z.ZodTypeAny, "passthrough">>>;
  go: z.ZodOptional<z.ZodObject<{
    simplify: z.ZodOptional<z.ZodBoolean>;
  }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    simplify: z.ZodOptional<z.ZodBoolean>;
  }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    simplify: z.ZodOptional<z.ZodBoolean>;
  }, z.ZodTypeAny, "passthrough">>>;
  php: z.ZodOptional<z.ZodObject<{
    rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
  }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
  }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
  }, z.ZodTypeAny, "passthrough">>>;
}, "strip", z.ZodTypeAny, {
  ignore?: string[] | undefined;
  typescript?: z.objectOutputType<{
    printWidth: z.ZodOptional<z.ZodNumber>;
    tabWidth: z.ZodOptional<z.ZodNumber>;
    useTabs: z.ZodOptional<z.ZodBoolean>;
    semi: z.ZodOptional<z.ZodBoolean>;
    singleQuote: z.ZodOptional<z.ZodBoolean>;
    jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
    trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
    bracketSpacing: z.ZodOptional<z.ZodBoolean>;
    bracketSameLine: z.ZodOptional<z.ZodBoolean>;
    arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
    proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
    singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
    endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
  }, z.ZodTypeAny, "passthrough"> | undefined;
  dart?: z.objectOutputType<{
    lineLength: z.ZodOptional<z.ZodNumber>;
  }, z.ZodTypeAny, "passthrough"> | undefined;
  python?: z.objectOutputType<{
    lineLength: z.ZodOptional<z.ZodNumber>;
    indentWidth: z.ZodOptional<z.ZodNumber>;
    quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
  }, z.ZodTypeAny, "passthrough"> | undefined;
  rust?: z.objectOutputType<{
    edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
    maxWidth: z.ZodOptional<z.ZodNumber>;
    tabSpaces: z.ZodOptional<z.ZodNumber>;
    useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
  }, z.ZodTypeAny, "passthrough"> | undefined;
  go?: z.objectOutputType<{
    simplify: z.ZodOptional<z.ZodBoolean>;
  }, z.ZodTypeAny, "passthrough"> | undefined;
  php?: z.objectOutputType<{
    rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
  }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
  ignore?: string[] | undefined;
  typescript?: z.objectInputType<{
    printWidth: z.ZodOptional<z.ZodNumber>;
    tabWidth: z.ZodOptional<z.ZodNumber>;
    useTabs: z.ZodOptional<z.ZodBoolean>;
    semi: z.ZodOptional<z.ZodBoolean>;
    singleQuote: z.ZodOptional<z.ZodBoolean>;
    jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
    trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
    bracketSpacing: z.ZodOptional<z.ZodBoolean>;
    bracketSameLine: z.ZodOptional<z.ZodBoolean>;
    arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
    proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
    singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
    endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
  }, z.ZodTypeAny, "passthrough"> | undefined;
  dart?: z.objectInputType<{
    lineLength: z.ZodOptional<z.ZodNumber>;
  }, z.ZodTypeAny, "passthrough"> | undefined;
  python?: z.objectInputType<{
    lineLength: z.ZodOptional<z.ZodNumber>;
    indentWidth: z.ZodOptional<z.ZodNumber>;
    quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
  }, z.ZodTypeAny, "passthrough"> | undefined;
  rust?: z.objectInputType<{
    edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
    maxWidth: z.ZodOptional<z.ZodNumber>;
    tabSpaces: z.ZodOptional<z.ZodNumber>;
    useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
  }, z.ZodTypeAny, "passthrough"> | undefined;
  go?: z.objectInputType<{
    simplify: z.ZodOptional<z.ZodBoolean>;
  }, z.ZodTypeAny, "passthrough"> | undefined;
  php?: z.objectInputType<{
    rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
  }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
declare const lintTypescriptSchema: z.ZodObject<{
  categories: z.ZodOptional<z.ZodObject<{
    correctness: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
    suspicious: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
    pedantic: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
    perf: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
    style: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
    restriction: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
    nursery: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
  }, "strip", z.ZodTypeAny, {
    style?: "off" | "warn" | "error" | undefined;
    perf?: "off" | "warn" | "error" | undefined;
    correctness?: "off" | "warn" | "error" | undefined;
    suspicious?: "off" | "warn" | "error" | undefined;
    pedantic?: "off" | "warn" | "error" | undefined;
    restriction?: "off" | "warn" | "error" | undefined;
    nursery?: "off" | "warn" | "error" | undefined;
  }, {
    style?: "off" | "warn" | "error" | undefined;
    perf?: "off" | "warn" | "error" | undefined;
    correctness?: "off" | "warn" | "error" | undefined;
    suspicious?: "off" | "warn" | "error" | undefined;
    pedantic?: "off" | "warn" | "error" | undefined;
    restriction?: "off" | "warn" | "error" | undefined;
    nursery?: "off" | "warn" | "error" | undefined;
  }>>;
  rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
  categories?: {
    style?: "off" | "warn" | "error" | undefined;
    perf?: "off" | "warn" | "error" | undefined;
    correctness?: "off" | "warn" | "error" | undefined;
    suspicious?: "off" | "warn" | "error" | undefined;
    pedantic?: "off" | "warn" | "error" | undefined;
    restriction?: "off" | "warn" | "error" | undefined;
    nursery?: "off" | "warn" | "error" | undefined;
  } | undefined;
  rules?: Record<string, unknown> | undefined;
}, {
  categories?: {
    style?: "off" | "warn" | "error" | undefined;
    perf?: "off" | "warn" | "error" | undefined;
    correctness?: "off" | "warn" | "error" | undefined;
    suspicious?: "off" | "warn" | "error" | undefined;
    pedantic?: "off" | "warn" | "error" | undefined;
    restriction?: "off" | "warn" | "error" | undefined;
    nursery?: "off" | "warn" | "error" | undefined;
  } | undefined;
  rules?: Record<string, unknown> | undefined;
}>;
declare const lintDartSchema: z.ZodObject<{
  strict: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
  strict?: boolean | undefined;
}, {
  strict?: boolean | undefined;
}>;
declare const lintPythonSchema: z.ZodObject<{
  select: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
  ignore: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
  fixable: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
  targetVersion: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
  ignore?: string[] | undefined;
  select?: string[] | undefined;
  fixable?: string[] | undefined;
  targetVersion?: string | undefined;
}, {
  ignore?: string[] | undefined;
  select?: string[] | undefined;
  fixable?: string[] | undefined;
  targetVersion?: string | undefined;
}>;
declare const lintRustSchema: z.ZodObject<{
  denyWarnings: z.ZodOptional<z.ZodBoolean>;
  features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
  denyWarnings?: boolean | undefined;
  features?: string[] | undefined;
}, {
  denyWarnings?: boolean | undefined;
  features?: string[] | undefined;
}>;
declare const lintGoSchema: z.ZodObject<{
  enable: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
  disable: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
  timeout: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
  enable?: string[] | undefined;
  disable?: string[] | undefined;
  timeout?: string | undefined;
}, {
  enable?: string[] | undefined;
  disable?: string[] | undefined;
  timeout?: string | undefined;
}>;
declare const lintPhpSchema: z.ZodObject<{
  level: z.ZodOptional<z.ZodNumber>;
  paths: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
  level?: number | undefined;
  paths?: string[] | undefined;
}, {
  level?: number | undefined;
  paths?: string[] | undefined;
}>;
declare const lintSchema: z.ZodObject<{
  ignore: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
  typescript: z.ZodOptional<z.ZodObject<{
    categories: z.ZodOptional<z.ZodObject<{
      correctness: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
      suspicious: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
      pedantic: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
      perf: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
      style: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
      restriction: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
      nursery: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
    }, "strip", z.ZodTypeAny, {
      style?: "off" | "warn" | "error" | undefined;
      perf?: "off" | "warn" | "error" | undefined;
      correctness?: "off" | "warn" | "error" | undefined;
      suspicious?: "off" | "warn" | "error" | undefined;
      pedantic?: "off" | "warn" | "error" | undefined;
      restriction?: "off" | "warn" | "error" | undefined;
      nursery?: "off" | "warn" | "error" | undefined;
    }, {
      style?: "off" | "warn" | "error" | undefined;
      perf?: "off" | "warn" | "error" | undefined;
      correctness?: "off" | "warn" | "error" | undefined;
      suspicious?: "off" | "warn" | "error" | undefined;
      pedantic?: "off" | "warn" | "error" | undefined;
      restriction?: "off" | "warn" | "error" | undefined;
      nursery?: "off" | "warn" | "error" | undefined;
    }>>;
    rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  }, "strip", z.ZodTypeAny, {
    categories?: {
      style?: "off" | "warn" | "error" | undefined;
      perf?: "off" | "warn" | "error" | undefined;
      correctness?: "off" | "warn" | "error" | undefined;
      suspicious?: "off" | "warn" | "error" | undefined;
      pedantic?: "off" | "warn" | "error" | undefined;
      restriction?: "off" | "warn" | "error" | undefined;
      nursery?: "off" | "warn" | "error" | undefined;
    } | undefined;
    rules?: Record<string, unknown> | undefined;
  }, {
    categories?: {
      style?: "off" | "warn" | "error" | undefined;
      perf?: "off" | "warn" | "error" | undefined;
      correctness?: "off" | "warn" | "error" | undefined;
      suspicious?: "off" | "warn" | "error" | undefined;
      pedantic?: "off" | "warn" | "error" | undefined;
      restriction?: "off" | "warn" | "error" | undefined;
      nursery?: "off" | "warn" | "error" | undefined;
    } | undefined;
    rules?: Record<string, unknown> | undefined;
  }>>;
  dart: z.ZodOptional<z.ZodObject<{
    strict: z.ZodOptional<z.ZodBoolean>;
  }, "strip", z.ZodTypeAny, {
    strict?: boolean | undefined;
  }, {
    strict?: boolean | undefined;
  }>>;
  python: z.ZodOptional<z.ZodObject<{
    select: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    ignore: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    fixable: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    targetVersion: z.ZodOptional<z.ZodString>;
  }, "strip", z.ZodTypeAny, {
    ignore?: string[] | undefined;
    select?: string[] | undefined;
    fixable?: string[] | undefined;
    targetVersion?: string | undefined;
  }, {
    ignore?: string[] | undefined;
    select?: string[] | undefined;
    fixable?: string[] | undefined;
    targetVersion?: string | undefined;
  }>>;
  rust: z.ZodOptional<z.ZodObject<{
    denyWarnings: z.ZodOptional<z.ZodBoolean>;
    features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
  }, "strip", z.ZodTypeAny, {
    denyWarnings?: boolean | undefined;
    features?: string[] | undefined;
  }, {
    denyWarnings?: boolean | undefined;
    features?: string[] | undefined;
  }>>;
  go: z.ZodOptional<z.ZodObject<{
    enable: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    disable: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    timeout: z.ZodOptional<z.ZodString>;
  }, "strip", z.ZodTypeAny, {
    enable?: string[] | undefined;
    disable?: string[] | undefined;
    timeout?: string | undefined;
  }, {
    enable?: string[] | undefined;
    disable?: string[] | undefined;
    timeout?: string | undefined;
  }>>;
  php: z.ZodOptional<z.ZodObject<{
    level: z.ZodOptional<z.ZodNumber>;
    paths: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
  }, "strip", z.ZodTypeAny, {
    level?: number | undefined;
    paths?: string[] | undefined;
  }, {
    level?: number | undefined;
    paths?: string[] | undefined;
  }>>;
}, "strip", z.ZodTypeAny, {
  ignore?: string[] | undefined;
  typescript?: {
    categories?: {
      style?: "off" | "warn" | "error" | undefined;
      perf?: "off" | "warn" | "error" | undefined;
      correctness?: "off" | "warn" | "error" | undefined;
      suspicious?: "off" | "warn" | "error" | undefined;
      pedantic?: "off" | "warn" | "error" | undefined;
      restriction?: "off" | "warn" | "error" | undefined;
      nursery?: "off" | "warn" | "error" | undefined;
    } | undefined;
    rules?: Record<string, unknown> | undefined;
  } | undefined;
  dart?: {
    strict?: boolean | undefined;
  } | undefined;
  python?: {
    ignore?: string[] | undefined;
    select?: string[] | undefined;
    fixable?: string[] | undefined;
    targetVersion?: string | undefined;
  } | undefined;
  rust?: {
    denyWarnings?: boolean | undefined;
    features?: string[] | undefined;
  } | undefined;
  go?: {
    enable?: string[] | undefined;
    disable?: string[] | undefined;
    timeout?: string | undefined;
  } | undefined;
  php?: {
    level?: number | undefined;
    paths?: string[] | undefined;
  } | undefined;
}, {
  ignore?: string[] | undefined;
  typescript?: {
    categories?: {
      style?: "off" | "warn" | "error" | undefined;
      perf?: "off" | "warn" | "error" | undefined;
      correctness?: "off" | "warn" | "error" | undefined;
      suspicious?: "off" | "warn" | "error" | undefined;
      pedantic?: "off" | "warn" | "error" | undefined;
      restriction?: "off" | "warn" | "error" | undefined;
      nursery?: "off" | "warn" | "error" | undefined;
    } | undefined;
    rules?: Record<string, unknown> | undefined;
  } | undefined;
  dart?: {
    strict?: boolean | undefined;
  } | undefined;
  python?: {
    ignore?: string[] | undefined;
    select?: string[] | undefined;
    fixable?: string[] | undefined;
    targetVersion?: string | undefined;
  } | undefined;
  rust?: {
    denyWarnings?: boolean | undefined;
    features?: string[] | undefined;
  } | undefined;
  go?: {
    enable?: string[] | undefined;
    disable?: string[] | undefined;
    timeout?: string | undefined;
  } | undefined;
  php?: {
    level?: number | undefined;
    paths?: string[] | undefined;
  } | undefined;
}>;
declare const HOOK_NAMES: readonly ["pre-commit", "commit-msg", "post-merge", "post-checkout"];
declare const hooksSchema: z.ZodObject<{
  "pre-commit": z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodLiteral<false>]>>;
  "commit-msg": z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodLiteral<false>]>>;
  "post-merge": z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodLiteral<false>]>>;
  "post-checkout": z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodLiteral<false>]>>;
}, "strip", z.ZodTypeAny, {
  "pre-commit"?: false | string[] | undefined;
  "commit-msg"?: false | string[] | undefined;
  "post-merge"?: false | string[] | undefined;
  "post-checkout"?: false | string[] | undefined;
}, {
  "pre-commit"?: false | string[] | undefined;
  "commit-msg"?: false | string[] | undefined;
  "post-merge"?: false | string[] | undefined;
  "post-checkout"?: false | string[] | undefined;
}>;
declare const configSchema: z.ZodObject<{
  workspace: z.ZodString;
  ecosystems: z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodObject<{
    manifest: z.ZodString;
    lockfile: z.ZodOptional<z.ZodString>;
    packages: z.ZodArray<z.ZodString, "many">;
  }, "strip", z.ZodTypeAny, {
    manifest: string;
    packages: string[];
    lockfile?: string | undefined;
  }, {
    manifest: string;
    packages: string[];
    lockfile?: string | undefined;
  }>>, Record<string, {
    manifest: string;
    packages: string[];
    lockfile?: string | undefined;
  }>, Record<string, {
    manifest: string;
    packages: string[];
    lockfile?: string | undefined;
  }>>;
  bridges: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
    source: z.ZodString;
    artifact: z.ZodString;
    consumers: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodObject<{
      path: z.ZodString;
      format: z.ZodOptional<z.ZodEnum<["css", "tailwind", "material3", "bootstrap", "tokens"]>>;
    }, "strip", z.ZodTypeAny, {
      path: string;
      format?: "css" | "tailwind" | "material3" | "bootstrap" | "tokens" | undefined;
    }, {
      path: string;
      format?: "css" | "tailwind" | "material3" | "bootstrap" | "tokens" | undefined;
    }>]>, "many">>;
    /** @deprecated since v0.4.0. Use `consumers` instead. Auto-migrated on load. */
    target: z.ZodOptional<z.ZodString>;
    run: z.ZodOptional<z.ZodString>;
    watch: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    entryFile: z.ZodOptional<z.ZodString>;
    specPath: z.ZodOptional<z.ZodString>;
    /** Path prefixes to exclude from generated output */
    exclude: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
  }, "strip", z.ZodTypeAny, {
    source: string;
    artifact: string;
    consumers?: (string | {
      path: string;
      format?: "css" | "tailwind" | "material3" | "bootstrap" | "tokens" | undefined;
    })[] | undefined;
    target?: string | undefined;
    run?: string | undefined;
    watch?: string[] | undefined;
    entryFile?: string | undefined;
    specPath?: string | undefined;
    exclude?: string[] | undefined;
  }, {
    source: string;
    artifact: string;
    consumers?: (string | {
      path: string;
      format?: "css" | "tailwind" | "material3" | "bootstrap" | "tokens" | undefined;
    })[] | undefined;
    target?: string | undefined;
    run?: string | undefined;
    watch?: string[] | undefined;
    entryFile?: string | undefined;
    specPath?: string | undefined;
    exclude?: string[] | undefined;
  }>, {
    source: string;
    artifact: string;
    consumers?: (string | {
      path: string;
      format?: "css" | "tailwind" | "material3" | "bootstrap" | "tokens" | undefined;
    })[] | undefined;
    target?: string | undefined;
    run?: string | undefined;
    watch?: string[] | undefined;
    entryFile?: string | undefined;
    specPath?: string | undefined;
    exclude?: string[] | undefined;
  }, {
    source: string;
    artifact: string;
    consumers?: (string | {
      path: string;
      format?: "css" | "tailwind" | "material3" | "bootstrap" | "tokens" | undefined;
    })[] | undefined;
    target?: string | undefined;
    run?: string | undefined;
    watch?: string[] | undefined;
    entryFile?: string | undefined;
    specPath?: string | undefined;
    exclude?: string[] | undefined;
  }>, "many">>;
  env: z.ZodOptional<z.ZodObject<{
    shared: z.ZodArray<z.ZodString, "many">;
    files: z.ZodArray<z.ZodString, "many">;
  }, "strip", z.ZodTypeAny, {
    shared: string[];
    files: string[];
  }, {
    shared: string[];
    files: string[];
  }>>;
  commits: z.ZodOptional<z.ZodObject<{
    types: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    scopes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    header_max_length: z.ZodDefault<z.ZodNumber>;
    body_max_line_length: z.ZodDefault<z.ZodNumber>;
  }, "strip", z.ZodTypeAny, {
    types: string[];
    header_max_length: number;
    body_max_line_length: number;
    scopes?: string[] | undefined;
  }, {
    types?: string[] | undefined;
    scopes?: string[] | undefined;
    header_max_length?: number | undefined;
    body_max_line_length?: number | undefined;
  }>>;
  lint: z.ZodOptional<z.ZodObject<{
    ignore: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    typescript: z.ZodOptional<z.ZodObject<{
      categories: z.ZodOptional<z.ZodObject<{
        correctness: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
        suspicious: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
        pedantic: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
        perf: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
        style: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
        restriction: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
        nursery: z.ZodOptional<z.ZodEnum<["off", "warn", "error"]>>;
      }, "strip", z.ZodTypeAny, {
        style?: "off" | "warn" | "error" | undefined;
        perf?: "off" | "warn" | "error" | undefined;
        correctness?: "off" | "warn" | "error" | undefined;
        suspicious?: "off" | "warn" | "error" | undefined;
        pedantic?: "off" | "warn" | "error" | undefined;
        restriction?: "off" | "warn" | "error" | undefined;
        nursery?: "off" | "warn" | "error" | undefined;
      }, {
        style?: "off" | "warn" | "error" | undefined;
        perf?: "off" | "warn" | "error" | undefined;
        correctness?: "off" | "warn" | "error" | undefined;
        suspicious?: "off" | "warn" | "error" | undefined;
        pedantic?: "off" | "warn" | "error" | undefined;
        restriction?: "off" | "warn" | "error" | undefined;
        nursery?: "off" | "warn" | "error" | undefined;
      }>>;
      rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
      categories?: {
        style?: "off" | "warn" | "error" | undefined;
        perf?: "off" | "warn" | "error" | undefined;
        correctness?: "off" | "warn" | "error" | undefined;
        suspicious?: "off" | "warn" | "error" | undefined;
        pedantic?: "off" | "warn" | "error" | undefined;
        restriction?: "off" | "warn" | "error" | undefined;
        nursery?: "off" | "warn" | "error" | undefined;
      } | undefined;
      rules?: Record<string, unknown> | undefined;
    }, {
      categories?: {
        style?: "off" | "warn" | "error" | undefined;
        perf?: "off" | "warn" | "error" | undefined;
        correctness?: "off" | "warn" | "error" | undefined;
        suspicious?: "off" | "warn" | "error" | undefined;
        pedantic?: "off" | "warn" | "error" | undefined;
        restriction?: "off" | "warn" | "error" | undefined;
        nursery?: "off" | "warn" | "error" | undefined;
      } | undefined;
      rules?: Record<string, unknown> | undefined;
    }>>;
    dart: z.ZodOptional<z.ZodObject<{
      strict: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
      strict?: boolean | undefined;
    }, {
      strict?: boolean | undefined;
    }>>;
    python: z.ZodOptional<z.ZodObject<{
      select: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
      ignore: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
      fixable: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
      targetVersion: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
      ignore?: string[] | undefined;
      select?: string[] | undefined;
      fixable?: string[] | undefined;
      targetVersion?: string | undefined;
    }, {
      ignore?: string[] | undefined;
      select?: string[] | undefined;
      fixable?: string[] | undefined;
      targetVersion?: string | undefined;
    }>>;
    rust: z.ZodOptional<z.ZodObject<{
      denyWarnings: z.ZodOptional<z.ZodBoolean>;
      features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
      denyWarnings?: boolean | undefined;
      features?: string[] | undefined;
    }, {
      denyWarnings?: boolean | undefined;
      features?: string[] | undefined;
    }>>;
    go: z.ZodOptional<z.ZodObject<{
      enable: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
      disable: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
      timeout: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
      enable?: string[] | undefined;
      disable?: string[] | undefined;
      timeout?: string | undefined;
    }, {
      enable?: string[] | undefined;
      disable?: string[] | undefined;
      timeout?: string | undefined;
    }>>;
    php: z.ZodOptional<z.ZodObject<{
      level: z.ZodOptional<z.ZodNumber>;
      paths: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
      level?: number | undefined;
      paths?: string[] | undefined;
    }, {
      level?: number | undefined;
      paths?: string[] | undefined;
    }>>;
  }, "strip", z.ZodTypeAny, {
    ignore?: string[] | undefined;
    typescript?: {
      categories?: {
        style?: "off" | "warn" | "error" | undefined;
        perf?: "off" | "warn" | "error" | undefined;
        correctness?: "off" | "warn" | "error" | undefined;
        suspicious?: "off" | "warn" | "error" | undefined;
        pedantic?: "off" | "warn" | "error" | undefined;
        restriction?: "off" | "warn" | "error" | undefined;
        nursery?: "off" | "warn" | "error" | undefined;
      } | undefined;
      rules?: Record<string, unknown> | undefined;
    } | undefined;
    dart?: {
      strict?: boolean | undefined;
    } | undefined;
    python?: {
      ignore?: string[] | undefined;
      select?: string[] | undefined;
      fixable?: string[] | undefined;
      targetVersion?: string | undefined;
    } | undefined;
    rust?: {
      denyWarnings?: boolean | undefined;
      features?: string[] | undefined;
    } | undefined;
    go?: {
      enable?: string[] | undefined;
      disable?: string[] | undefined;
      timeout?: string | undefined;
    } | undefined;
    php?: {
      level?: number | undefined;
      paths?: string[] | undefined;
    } | undefined;
  }, {
    ignore?: string[] | undefined;
    typescript?: {
      categories?: {
        style?: "off" | "warn" | "error" | undefined;
        perf?: "off" | "warn" | "error" | undefined;
        correctness?: "off" | "warn" | "error" | undefined;
        suspicious?: "off" | "warn" | "error" | undefined;
        pedantic?: "off" | "warn" | "error" | undefined;
        restriction?: "off" | "warn" | "error" | undefined;
        nursery?: "off" | "warn" | "error" | undefined;
      } | undefined;
      rules?: Record<string, unknown> | undefined;
    } | undefined;
    dart?: {
      strict?: boolean | undefined;
    } | undefined;
    python?: {
      ignore?: string[] | undefined;
      select?: string[] | undefined;
      fixable?: string[] | undefined;
      targetVersion?: string | undefined;
    } | undefined;
    rust?: {
      denyWarnings?: boolean | undefined;
      features?: string[] | undefined;
    } | undefined;
    go?: {
      enable?: string[] | undefined;
      disable?: string[] | undefined;
      timeout?: string | undefined;
    } | undefined;
    php?: {
      level?: number | undefined;
      paths?: string[] | undefined;
    } | undefined;
  }>>;
  format: z.ZodOptional<z.ZodObject<{
    ignore: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    typescript: z.ZodOptional<z.ZodObject<{
      printWidth: z.ZodOptional<z.ZodNumber>;
      tabWidth: z.ZodOptional<z.ZodNumber>;
      useTabs: z.ZodOptional<z.ZodBoolean>;
      semi: z.ZodOptional<z.ZodBoolean>;
      singleQuote: z.ZodOptional<z.ZodBoolean>;
      jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
      trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
      bracketSpacing: z.ZodOptional<z.ZodBoolean>;
      bracketSameLine: z.ZodOptional<z.ZodBoolean>;
      arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
      proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
      singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
      endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
      printWidth: z.ZodOptional<z.ZodNumber>;
      tabWidth: z.ZodOptional<z.ZodNumber>;
      useTabs: z.ZodOptional<z.ZodBoolean>;
      semi: z.ZodOptional<z.ZodBoolean>;
      singleQuote: z.ZodOptional<z.ZodBoolean>;
      jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
      trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
      bracketSpacing: z.ZodOptional<z.ZodBoolean>;
      bracketSameLine: z.ZodOptional<z.ZodBoolean>;
      arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
      proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
      singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
      endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
      printWidth: z.ZodOptional<z.ZodNumber>;
      tabWidth: z.ZodOptional<z.ZodNumber>;
      useTabs: z.ZodOptional<z.ZodBoolean>;
      semi: z.ZodOptional<z.ZodBoolean>;
      singleQuote: z.ZodOptional<z.ZodBoolean>;
      jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
      trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
      bracketSpacing: z.ZodOptional<z.ZodBoolean>;
      bracketSameLine: z.ZodOptional<z.ZodBoolean>;
      arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
      proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
      singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
      endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
    }, z.ZodTypeAny, "passthrough">>>;
    dart: z.ZodOptional<z.ZodObject<{
      lineLength: z.ZodOptional<z.ZodNumber>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
      lineLength: z.ZodOptional<z.ZodNumber>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
      lineLength: z.ZodOptional<z.ZodNumber>;
    }, z.ZodTypeAny, "passthrough">>>;
    python: z.ZodOptional<z.ZodObject<{
      lineLength: z.ZodOptional<z.ZodNumber>;
      indentWidth: z.ZodOptional<z.ZodNumber>;
      quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
      lineLength: z.ZodOptional<z.ZodNumber>;
      indentWidth: z.ZodOptional<z.ZodNumber>;
      quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
      lineLength: z.ZodOptional<z.ZodNumber>;
      indentWidth: z.ZodOptional<z.ZodNumber>;
      quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
    }, z.ZodTypeAny, "passthrough">>>;
    rust: z.ZodOptional<z.ZodObject<{
      edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
      maxWidth: z.ZodOptional<z.ZodNumber>;
      tabSpaces: z.ZodOptional<z.ZodNumber>;
      useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
      edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
      maxWidth: z.ZodOptional<z.ZodNumber>;
      tabSpaces: z.ZodOptional<z.ZodNumber>;
      useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
      edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
      maxWidth: z.ZodOptional<z.ZodNumber>;
      tabSpaces: z.ZodOptional<z.ZodNumber>;
      useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
    }, z.ZodTypeAny, "passthrough">>>;
    go: z.ZodOptional<z.ZodObject<{
      simplify: z.ZodOptional<z.ZodBoolean>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
      simplify: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
      simplify: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">>>;
    php: z.ZodOptional<z.ZodObject<{
      rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
      preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
      rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
      preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
      rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
      preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
    }, z.ZodTypeAny, "passthrough">>>;
  }, "strip", z.ZodTypeAny, {
    ignore?: string[] | undefined;
    typescript?: z.objectOutputType<{
      printWidth: z.ZodOptional<z.ZodNumber>;
      tabWidth: z.ZodOptional<z.ZodNumber>;
      useTabs: z.ZodOptional<z.ZodBoolean>;
      semi: z.ZodOptional<z.ZodBoolean>;
      singleQuote: z.ZodOptional<z.ZodBoolean>;
      jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
      trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
      bracketSpacing: z.ZodOptional<z.ZodBoolean>;
      bracketSameLine: z.ZodOptional<z.ZodBoolean>;
      arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
      proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
      singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
      endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    dart?: z.objectOutputType<{
      lineLength: z.ZodOptional<z.ZodNumber>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    python?: z.objectOutputType<{
      lineLength: z.ZodOptional<z.ZodNumber>;
      indentWidth: z.ZodOptional<z.ZodNumber>;
      quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    rust?: z.objectOutputType<{
      edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
      maxWidth: z.ZodOptional<z.ZodNumber>;
      tabSpaces: z.ZodOptional<z.ZodNumber>;
      useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    go?: z.objectOutputType<{
      simplify: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    php?: z.objectOutputType<{
      rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
      preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
  }, {
    ignore?: string[] | undefined;
    typescript?: z.objectInputType<{
      printWidth: z.ZodOptional<z.ZodNumber>;
      tabWidth: z.ZodOptional<z.ZodNumber>;
      useTabs: z.ZodOptional<z.ZodBoolean>;
      semi: z.ZodOptional<z.ZodBoolean>;
      singleQuote: z.ZodOptional<z.ZodBoolean>;
      jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
      trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
      bracketSpacing: z.ZodOptional<z.ZodBoolean>;
      bracketSameLine: z.ZodOptional<z.ZodBoolean>;
      arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
      proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
      singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
      endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    dart?: z.objectInputType<{
      lineLength: z.ZodOptional<z.ZodNumber>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    python?: z.objectInputType<{
      lineLength: z.ZodOptional<z.ZodNumber>;
      indentWidth: z.ZodOptional<z.ZodNumber>;
      quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    rust?: z.objectInputType<{
      edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
      maxWidth: z.ZodOptional<z.ZodNumber>;
      tabSpaces: z.ZodOptional<z.ZodNumber>;
      useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    go?: z.objectInputType<{
      simplify: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    php?: z.objectInputType<{
      rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
      preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
  }>>;
  hooks: z.ZodOptional<z.ZodObject<{
    "pre-commit": z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodLiteral<false>]>>;
    "commit-msg": z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodLiteral<false>]>>;
    "post-merge": z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodLiteral<false>]>>;
    "post-checkout": z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodLiteral<false>]>>;
  }, "strip", z.ZodTypeAny, {
    "pre-commit"?: false | string[] | undefined;
    "commit-msg"?: false | string[] | undefined;
    "post-merge"?: false | string[] | undefined;
    "post-checkout"?: false | string[] | undefined;
  }, {
    "pre-commit"?: false | string[] | undefined;
    "commit-msg"?: false | string[] | undefined;
    "post-merge"?: false | string[] | undefined;
    "post-checkout"?: false | string[] | undefined;
  }>>;
}, "strip", z.ZodTypeAny, {
  workspace: string;
  ecosystems: Record<string, {
    manifest: string;
    packages: string[];
    lockfile?: string | undefined;
  }>;
  format?: {
    ignore?: string[] | undefined;
    typescript?: z.objectOutputType<{
      printWidth: z.ZodOptional<z.ZodNumber>;
      tabWidth: z.ZodOptional<z.ZodNumber>;
      useTabs: z.ZodOptional<z.ZodBoolean>;
      semi: z.ZodOptional<z.ZodBoolean>;
      singleQuote: z.ZodOptional<z.ZodBoolean>;
      jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
      trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
      bracketSpacing: z.ZodOptional<z.ZodBoolean>;
      bracketSameLine: z.ZodOptional<z.ZodBoolean>;
      arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
      proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
      singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
      endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    dart?: z.objectOutputType<{
      lineLength: z.ZodOptional<z.ZodNumber>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    python?: z.objectOutputType<{
      lineLength: z.ZodOptional<z.ZodNumber>;
      indentWidth: z.ZodOptional<z.ZodNumber>;
      quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    rust?: z.objectOutputType<{
      edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
      maxWidth: z.ZodOptional<z.ZodNumber>;
      tabSpaces: z.ZodOptional<z.ZodNumber>;
      useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    go?: z.objectOutputType<{
      simplify: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    php?: z.objectOutputType<{
      rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
      preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
  } | undefined;
  bridges?: {
    source: string;
    artifact: string;
    consumers?: (string | {
      path: string;
      format?: "css" | "tailwind" | "material3" | "bootstrap" | "tokens" | undefined;
    })[] | undefined;
    target?: string | undefined;
    run?: string | undefined;
    watch?: string[] | undefined;
    entryFile?: string | undefined;
    specPath?: string | undefined;
    exclude?: string[] | undefined;
  }[] | undefined;
  env?: {
    shared: string[];
    files: string[];
  } | undefined;
  commits?: {
    types: string[];
    header_max_length: number;
    body_max_line_length: number;
    scopes?: string[] | undefined;
  } | undefined;
  lint?: {
    ignore?: string[] | undefined;
    typescript?: {
      categories?: {
        style?: "off" | "warn" | "error" | undefined;
        perf?: "off" | "warn" | "error" | undefined;
        correctness?: "off" | "warn" | "error" | undefined;
        suspicious?: "off" | "warn" | "error" | undefined;
        pedantic?: "off" | "warn" | "error" | undefined;
        restriction?: "off" | "warn" | "error" | undefined;
        nursery?: "off" | "warn" | "error" | undefined;
      } | undefined;
      rules?: Record<string, unknown> | undefined;
    } | undefined;
    dart?: {
      strict?: boolean | undefined;
    } | undefined;
    python?: {
      ignore?: string[] | undefined;
      select?: string[] | undefined;
      fixable?: string[] | undefined;
      targetVersion?: string | undefined;
    } | undefined;
    rust?: {
      denyWarnings?: boolean | undefined;
      features?: string[] | undefined;
    } | undefined;
    go?: {
      enable?: string[] | undefined;
      disable?: string[] | undefined;
      timeout?: string | undefined;
    } | undefined;
    php?: {
      level?: number | undefined;
      paths?: string[] | undefined;
    } | undefined;
  } | undefined;
  hooks?: {
    "pre-commit"?: false | string[] | undefined;
    "commit-msg"?: false | string[] | undefined;
    "post-merge"?: false | string[] | undefined;
    "post-checkout"?: false | string[] | undefined;
  } | undefined;
}, {
  workspace: string;
  ecosystems: Record<string, {
    manifest: string;
    packages: string[];
    lockfile?: string | undefined;
  }>;
  format?: {
    ignore?: string[] | undefined;
    typescript?: z.objectInputType<{
      printWidth: z.ZodOptional<z.ZodNumber>;
      tabWidth: z.ZodOptional<z.ZodNumber>;
      useTabs: z.ZodOptional<z.ZodBoolean>;
      semi: z.ZodOptional<z.ZodBoolean>;
      singleQuote: z.ZodOptional<z.ZodBoolean>;
      jsxSingleQuote: z.ZodOptional<z.ZodBoolean>;
      trailingComma: z.ZodOptional<z.ZodEnum<["all", "none", "es5"]>>;
      bracketSpacing: z.ZodOptional<z.ZodBoolean>;
      bracketSameLine: z.ZodOptional<z.ZodBoolean>;
      arrowParens: z.ZodOptional<z.ZodEnum<["always", "avoid"]>>;
      proseWrap: z.ZodOptional<z.ZodEnum<["preserve", "always", "never"]>>;
      singleAttributePerLine: z.ZodOptional<z.ZodBoolean>;
      endOfLine: z.ZodOptional<z.ZodEnum<["lf", "crlf", "cr", "auto"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    dart?: z.objectInputType<{
      lineLength: z.ZodOptional<z.ZodNumber>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    python?: z.objectInputType<{
      lineLength: z.ZodOptional<z.ZodNumber>;
      indentWidth: z.ZodOptional<z.ZodNumber>;
      quoteStyle: z.ZodOptional<z.ZodEnum<["single", "double"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    rust?: z.objectInputType<{
      edition: z.ZodOptional<z.ZodEnum<["2015", "2018", "2021", "2024"]>>;
      maxWidth: z.ZodOptional<z.ZodNumber>;
      tabSpaces: z.ZodOptional<z.ZodNumber>;
      useSmallHeuristics: z.ZodOptional<z.ZodEnum<["Default", "Off", "Max"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    go?: z.objectInputType<{
      simplify: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    php?: z.objectInputType<{
      rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
      preset: z.ZodOptional<z.ZodEnum<["psr12", "psr2", "symfony", "laravel", "per"]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
  } | undefined;
  bridges?: {
    source: string;
    artifact: string;
    consumers?: (string | {
      path: string;
      format?: "css" | "tailwind" | "material3" | "bootstrap" | "tokens" | undefined;
    })[] | undefined;
    target?: string | undefined;
    run?: string | undefined;
    watch?: string[] | undefined;
    entryFile?: string | undefined;
    specPath?: string | undefined;
    exclude?: string[] | undefined;
  }[] | undefined;
  env?: {
    shared: string[];
    files: string[];
  } | undefined;
  commits?: {
    types?: string[] | undefined;
    scopes?: string[] | undefined;
    header_max_length?: number | undefined;
    body_max_line_length?: number | undefined;
  } | undefined;
  lint?: {
    ignore?: string[] | undefined;
    typescript?: {
      categories?: {
        style?: "off" | "warn" | "error" | undefined;
        perf?: "off" | "warn" | "error" | undefined;
        correctness?: "off" | "warn" | "error" | undefined;
        suspicious?: "off" | "warn" | "error" | undefined;
        pedantic?: "off" | "warn" | "error" | undefined;
        restriction?: "off" | "warn" | "error" | undefined;
        nursery?: "off" | "warn" | "error" | undefined;
      } | undefined;
      rules?: Record<string, unknown> | undefined;
    } | undefined;
    dart?: {
      strict?: boolean | undefined;
    } | undefined;
    python?: {
      ignore?: string[] | undefined;
      select?: string[] | undefined;
      fixable?: string[] | undefined;
      targetVersion?: string | undefined;
    } | undefined;
    rust?: {
      denyWarnings?: boolean | undefined;
      features?: string[] | undefined;
    } | undefined;
    go?: {
      enable?: string[] | undefined;
      disable?: string[] | undefined;
      timeout?: string | undefined;
    } | undefined;
    php?: {
      level?: number | undefined;
      paths?: string[] | undefined;
    } | undefined;
  } | undefined;
  hooks?: {
    "pre-commit"?: false | string[] | undefined;
    "commit-msg"?: false | string[] | undefined;
    "post-merge"?: false | string[] | undefined;
    "post-checkout"?: false | string[] | undefined;
  } | undefined;
}>;
type NeutronConfig = z.infer<typeof configSchema>;
type EcosystemConfig = z.infer<typeof ecosystemSchema>;
type BridgeConfig = z.infer<typeof bridgeSchema>;
type EnvConfig = z.infer<typeof envSchema>;
type CommitsConfig = z.infer<typeof commitsSchema>;
type LintConfig = z.infer<typeof lintSchema>;
type LintTypescriptConfig = z.infer<typeof lintTypescriptSchema>;
type LintDartConfig = z.infer<typeof lintDartSchema>;
type FormatConfig = z.infer<typeof formatSchema>;
type FormatTypescriptConfig = z.infer<typeof formatTypescriptSchema>;
type FormatDartConfig = z.infer<typeof formatDartSchema>;
type FormatPythonConfig = z.infer<typeof formatPythonSchema>;
type FormatRustConfig = z.infer<typeof formatRustSchema>;
type FormatGoConfig = z.infer<typeof formatGoSchema>;
type FormatPhpConfig = z.infer<typeof formatPhpSchema>;
type LintPythonConfig = z.infer<typeof lintPythonSchema>;
type LintRustConfig = z.infer<typeof lintRustSchema>;
type LintGoConfig = z.infer<typeof lintGoSchema>;
type LintPhpConfig = z.infer<typeof lintPhpSchema>;
type HooksConfig = z.infer<typeof hooksSchema>;
//#endregion
export { NeutronConfig as C, LintTypescriptConfig as S, LintDartConfig as _, EcosystemConfig as a, LintPythonConfig as b, FormatDartConfig as c, FormatPythonConfig as d, FormatRustConfig as f, LintConfig as g, HooksConfig as h, DESIGN_FORMATS as i, FormatGoConfig as l, HOOK_NAMES as m, CommitsConfig as n, EnvConfig as o, FormatTypescriptConfig as p, DEFAULT_COMMIT_TYPES as r, FormatConfig as s, BridgeConfig as t, FormatPhpConfig as u, LintGoConfig as v, configSchema as w, LintRustConfig as x, LintPhpConfig as y };
//# sourceMappingURL=schema-6LgP2m9L.d.ts.map