/**
 * Generates schema.json for mido.yml — provides VS Code autocomplete
 * via yaml-language-server.
 *
 * Sources:
 *  - oxlint/configuration_schema.json for rule value types and categories
 *  - Hardcoded oxfmt options (stable, <15 options)
 *  - mido's own config shape
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OXFMT_DEFAULTS } from '../src/config/defaults.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ─── Read oxlint schema for rule value type ──────────────────────────────────

interface OxlintSchema {
  readonly definitions?: {
    readonly AllowWarnDeny?: Record<string, unknown>;
    readonly OxlintCategories?: {
      readonly properties?: Record<string, unknown>;
    };
  };
}

const oxlintSchemaPath = join(ROOT, 'node_modules', 'oxlint', 'configuration_schema.json');
const oxlintSchema: OxlintSchema = JSON.parse(readFileSync(oxlintSchemaPath, 'utf-8'));

// Rule value: "off"|"warn"|"error"|0|1|2 or array with options
const ruleValueSchema = {
  oneOf: [
    { type: 'string', enum: ['off', 'allow', 'warn', 'error', 'deny'] },
    { type: 'integer', minimum: 0, maximum: 2 },
    { type: 'array', description: 'Rule with options: [severity, ...options]' },
  ],
};

// ─── Category schema ─────────────────────────────────────────────────────────

const categoryLevel = {
  type: 'string',
  enum: ['off', 'warn', 'error'],
};

const categoriesSchema = {
  type: 'object',
  description:
    'Rule categories group 700+ rules by intent. Each category can be "off", "warn", or "error".',
  properties: {
    correctness: {
      ...categoryLevel,
      description: 'Code that is outright wrong or useless.',
      default: 'error',
    },
    suspicious: {
      ...categoryLevel,
      description: 'Code that is most likely wrong.',
      default: 'warn',
    },
    pedantic: {
      ...categoryLevel,
      description: 'Strict rules, occasional false positives.',
      default: 'off',
    },
    perf: {
      ...categoryLevel,
      description: 'Code that could be more performant.',
      default: 'warn',
    },
    style: {
      ...categoryLevel,
      description: 'Code style consistency.',
      default: 'off',
    },
    restriction: {
      ...categoryLevel,
      description: 'Prevents specific language features.',
      default: 'off',
    },
    nursery: {
      ...categoryLevel,
      description: 'Experimental rules under development.',
      default: 'off',
    },
  },
  additionalProperties: false,
};

// ─── Rules schema (extracted from oxlint --rules at build time) ──────────────

interface OxlintRule {
  readonly qualified: string;
  readonly category: string;
}

function extractRulesFromOxlint(): readonly OxlintRule[] {
  const oxlintBin = join(ROOT, 'node_modules', '.bin', 'oxlint');

  let output: string;
  try {
    output = execSync(`${oxlintBin} --rules`, { encoding: 'utf-8', timeout: 10_000 });
  } catch {
    console.warn('Warning: could not run oxlint --rules, rules autocomplete will be unavailable');
    return [];
  }

  const rules: OxlintRule[] = [];
  let category = '';

  for (const line of output.split('\n')) {
    const catMatch = /^## (\w+)/.exec(line);
    if (catMatch) {
      category = catMatch[1]?.toLowerCase() ?? '';
      continue;
    }
    // Parse table rows: | rule-name | source | ...
    const ruleMatch = /^\| ([\w-]+)\s+\| (\w+)/.exec(line);
    if (!ruleMatch || ruleMatch[1] === 'Rule name') {
      continue;
    }
    const name = ruleMatch[1] ?? '';
    const source = ruleMatch[2] ?? '';
    const qualified = source + '/' + name;
    rules.push({ qualified, category });
  }

  return rules;
}

const oxlintRules = extractRulesFromOxlint();
console.log(`Extracted ${oxlintRules.length} oxlint rules for schema autocomplete`);

const ruleProperties: Record<string, unknown> = {};
for (const rule of oxlintRules) {
  ruleProperties[rule.qualified] = {
    description: `[${rule.category}] ${rule.qualified}`,
    ...ruleValueSchema,
  };
}

const rulesSchema = {
  type: 'object',
  description:
    'Individual rule overrides. Keys are rule names (e.g. "eslint/eqeqeq", "import/no-cycle"), values are severity or [severity, ...options]. See https://oxc.rs/docs/guide/usage/linter/rules.html',
  properties: ruleProperties,
  additionalProperties: ruleValueSchema,
};

// ─── Assemble full schema ────────────────────────────────────────────────────

const midoSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'mido.yml',
  description: 'mido workspace configuration — cross-ecosystem monorepo tool',
  type: 'object',
  properties: {
    workspace: {
      type: 'string',
      description: 'Workspace name, used in generated package names and CLI output.',
    },
    ecosystems: {
      type: 'object',
      description: 'Language ecosystems and their packages.',
      additionalProperties: {
        type: 'object',
        properties: {
          manifest: {
            type: 'string',
            description: 'Manifest filename (e.g. "package.json", "pubspec.yaml").',
          },
          lockfile: {
            type: 'string',
            description: 'Optional lockfile name.',
          },
          packages: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            description: 'Package paths relative to workspace root.',
          },
        },
        required: ['manifest', 'packages'],
      },
    },
    bridges: {
      type: 'array',
      description: 'Cross-ecosystem dependencies linked by a shared artifact.',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Package that produces the artifact.' },
          consumers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Packages that consume the artifact.',
          },
          artifact: {
            type: 'string',
            description: 'Path to the shared file (e.g. openapi.json).',
          },
          run: {
            type: 'string',
            description: 'Fallback shell command when no plugin claims the bridge.',
          },
          watch: {
            type: 'array',
            items: { type: 'string' },
            description: 'Glob patterns to monitor for changes (used by mido dev).',
          },
          entryFile: {
            type: 'string',
            description: 'Server entry file relative to source package dir.',
          },
          specPath: { type: 'string', description: 'Custom OpenAPI spec endpoint path.' },
        },
        required: ['source', 'consumers', 'artifact'],
      },
    },
    env: {
      type: 'object',
      description: 'Environment variable parity across packages.',
      properties: {
        shared: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'Environment variable names that must be present in all env files.',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          description: 'Paths to env files to check for parity.',
        },
      },
      required: ['shared', 'files'],
    },
    format: {
      type: 'object',
      description:
        'Per-ecosystem formatting. mido picks the right formatter: TypeScript → oxfmt, Dart → dart format.',
      properties: {
        ignore: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns excluded from formatting across all ecosystems.',
        },
        typescript: {
          type: 'object',
          description: 'TypeScript formatting options (applied via the bundled oxfmt formatter). Any oxfmt/prettier-compatible option is accepted.',
          properties: {
            printWidth: { type: 'number', description: 'Maximum line width.', default: 80 },
            tabWidth: {
              type: 'number',
              description: 'Number of spaces per indentation level.',
              default: 2,
            },
            useTabs: {
              type: 'boolean',
              description: 'Indent with tabs instead of spaces.',
              default: false,
            },
            semi: {
              type: 'boolean',
              description: 'Add semicolons at the end of statements.',
              default: true,
            },
            singleQuote: {
              type: 'boolean',
              description: 'Use single quotes instead of double quotes.',
              default: false,
            },
            jsxSingleQuote: {
              type: 'boolean',
              description: 'Use single quotes in JSX.',
              default: false,
            },
            trailingComma: {
              type: 'string',
              enum: ['all', 'none', 'es5'],
              description: 'Trailing comma style.',
              default: 'all',
            },
            bracketSpacing: {
              type: 'boolean',
              description: 'Spaces between brackets in object literals.',
              default: true,
            },
            bracketSameLine: {
              type: 'boolean',
              description: 'Put > of multi-line elements on the last line.',
              default: false,
            },
            arrowParens: {
              type: 'string',
              enum: ['always', 'avoid'],
              description: 'Parentheses around single arrow function parameter.',
              default: 'always',
            },
            proseWrap: {
              type: 'string',
              enum: ['preserve', 'always', 'never'],
              description: 'How to wrap prose in markdown.',
              default: 'preserve',
            },
            singleAttributePerLine: {
              type: 'boolean',
              description: 'Enforce single attribute per line in HTML/JSX.',
              default: false,
            },
            endOfLine: {
              type: 'string',
              enum: ['lf', 'crlf', 'cr', 'auto'],
              description: 'Line ending style.',
              default: 'lf',
            },
            importOrder: {
              type: 'array',
              items: { type: 'string' },
              description: 'Import sorting order groups (oxfmt @ianvs/prettier-plugin-sort-imports compatible).',
            },
            importOrderTypeScriptVersion: {
              type: 'string',
              description: 'TypeScript version for import order parsing.',
            },
          },
          additionalProperties: true,
        },
        dart: {
          type: 'object',
          description: 'Dart formatting options (applied via dart format).',
          properties: {
            lineLength: { type: 'number', description: 'Maximum line length.', default: 80 },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
    lint: {
      type: 'object',
      description:
        'Per-ecosystem linting. mido picks the right linter: TypeScript → oxlint, Dart → dart analyze. Plugins auto-enabled based on dependencies.',
      properties: {
        ignore: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns excluded from linting across all ecosystems.',
        },
        typescript: {
          type: 'object',
          description:
            'TypeScript linting (oxlint). mido auto-enables plugins: typescript, unicorn, oxc, import; react/jsx-a11y if React detected.',
          properties: {
            categories: categoriesSchema,
            rules: rulesSchema,
          },
          additionalProperties: false,
        },
        dart: {
          type: 'object',
          description:
            'Dart linting (dart analyze). Respects analysis_options.yaml in each package.',
          properties: {
            strict: {
              type: 'boolean',
              description: 'Enable strict analysis (--fatal-infos).',
              default: false,
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    hooks: {
      type: 'object',
      description:
        'Git hooks installed by `mido install`. Each hook is a list of shell commands run sequentially (stops on first failure). Set a hook to `false` to disable it. Changes are applied on `mido install` or when mido.yml is saved during `mido dev`.',
      properties: {
        'pre-commit': {
          oneOf: [
            {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              description:
                'Commands to run before each commit. Default: `mido pre-commit` (format check → lint → workspace check).',
            },
            {
              const: false,
              description: 'Disable this hook. Removes the hook file if mido-owned.',
            },
          ],
        },
        'commit-msg': {
          oneOf: [
            {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              description:
                'Commands to validate the commit message. Receives the message file path as $1. Default: `mido commit-msg "$1"`.',
            },
            {
              const: false,
              description: 'Disable this hook. Removes the hook file if mido-owned.',
            },
          ],
        },
        'post-merge': {
          oneOf: [
            {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              description:
                'Commands to run after a merge. Default: workspace drift check.',
            },
            {
              const: false,
              description: 'Disable this hook. Removes the hook file if mido-owned.',
            },
          ],
        },
        'post-checkout': {
          oneOf: [
            {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              description:
                'Commands to run after a branch checkout (not file checkout). Default: workspace drift check.',
            },
            {
              const: false,
              description: 'Disable this hook. Removes the hook file if mido-owned.',
            },
          ],
        },
      },
      additionalProperties: false,
    },
    commits: {
      type: 'object',
      description:
        "Conventional commit validation, enforced by mido's commit-msg git hook. Run `mido install` to set up hooks.",
      properties: {
        types: {
          type: 'array',
          description: 'Allowed commit types. Defaults to conventional commit types; add custom types as needed.',
          items: { type: 'string' },
          examples: [['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert']],
        },
        scopes: {
          type: 'array',
          description: 'Allowed commit scopes. Empty array allows any scope.',
          items: { type: 'string' },
        },
        header_max_length: {
          type: 'number',
          description: 'Maximum length of the commit header line.',
          default: 100,
        },
        body_max_line_length: {
          type: 'number',
          description: 'Maximum line length in commit body.',
          default: 200,
        },
      },
      additionalProperties: false,
    },
  },
  required: ['workspace', 'ecosystems'],
  additionalProperties: false,
};

// ─── Write ───────────────────────────────────────────────────────────────────

const outputPath = join(ROOT, 'schema.json');
writeFileSync(outputPath, JSON.stringify(midoSchema, null, 2) + '\n', 'utf-8');

const size = (readFileSync(outputPath).length / 1024).toFixed(1);
console.log(`schema.json generated (${size} KB)`);
