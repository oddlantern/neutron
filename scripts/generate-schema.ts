/**
 * Generates schema.json for neutron.yml — provides VS Code autocomplete
 * via yaml-language-server.
 *
 * Derives the schema structure from the Zod config schema (single source of truth),
 * then enriches with:
 *  - oxlint rule names extracted at build time (for autocomplete)
 *  - Descriptions and defaults for better DX
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { configSchema } from '../src/config/schema.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ─── Zod → JSON Schema converter ────────────────────────────────────────────

type JsonSchema = Record<string, unknown>;

/**
 * Convert a Zod schema to a JSON Schema object.
 * Handles the subset of Zod types used in neutron's config.
 */
function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = schema._def;
  const typeName: string = def.typeName;

  switch (typeName) {
    case 'ZodString':
      return { type: 'string' };

    case 'ZodNumber':
      return { type: 'number' };

    case 'ZodBoolean':
      return { type: 'boolean' };

    case 'ZodLiteral':
      return { const: def.value };

    case 'ZodEnum':
      return { type: 'string', enum: def.values };

    case 'ZodArray': {
      const items = zodToJsonSchema(def.type);
      const result: JsonSchema = { type: 'array', items };
      if (def.minLength?.value !== undefined) {
        result['minItems'] = def.minLength.value;
      }
      return result;
    }

    case 'ZodObject': {
      const shape = def.shape();
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        const innerSchema = value as z.ZodTypeAny;
        const unwrapped = unwrapOptional(innerSchema);
        properties[key] = zodToJsonSchema(unwrapped.schema);
        if (!unwrapped.optional) {
          required.push(key);
        }
      }

      const result: JsonSchema = { type: 'object', properties };
      if (required.length > 0) {
        result['required'] = required;
      }

      // Check for passthrough (additionalProperties: true)
      const unknownKeys: string = def.unknownKeys;
      if (unknownKeys === 'passthrough') {
        result['additionalProperties'] = true;
      } else {
        result['additionalProperties'] = false;
      }

      return result;
    }

    case 'ZodRecord': {
      const valueSchema = zodToJsonSchema(def.valueType);
      return { type: 'object', additionalProperties: valueSchema };
    }

    case 'ZodUnion': {
      const options = (def.options as z.ZodTypeAny[]).map(zodToJsonSchema);
      return { oneOf: options };
    }

    case 'ZodOptional':
      return zodToJsonSchema(def.innerType);

    case 'ZodDefault':
      return { ...zodToJsonSchema(def.innerType), default: def.defaultValue() };

    case 'ZodEffects':
      // .refine() / .transform() — pass through to the inner schema
      return zodToJsonSchema(def.schema);

    default:
      return {};
  }
}

/** Unwrap optional and default wrappers, tracking if the field is optional. */
function unwrapOptional(schema: z.ZodTypeAny): { schema: z.ZodTypeAny; optional: boolean } {
  const typeName: string = schema._def.typeName;

  if (typeName === 'ZodOptional') {
    return { schema: schema._def.innerType, optional: true };
  }
  if (typeName === 'ZodDefault') {
    return { schema: schema._def.innerType, optional: true };
  }
  return { schema, optional: false };
}

// ─── Generate base schema from Zod ──────────────────────────────────────────

const baseSchema = zodToJsonSchema(configSchema) as {
  type: string;
  properties: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
};

// ─── Enrich with oxlint rule autocomplete ────────────────────────────────────

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
    const ruleMatch = /^\| ([\w-]+)\s+\| (\w+)/.exec(line);
    if (!ruleMatch || ruleMatch[1] === 'Rule name') {
      continue;
    }
    const name = ruleMatch[1] ?? '';
    const source = ruleMatch[2] ?? '';
    rules.push({ qualified: `${source}/${name}`, category });
  }

  return rules;
}

const oxlintRules = extractRulesFromOxlint();
console.log(`Extracted ${oxlintRules.length} oxlint rules for schema autocomplete`);

// Build rule properties with descriptions
const ruleValueSchema: JsonSchema = {
  oneOf: [
    { type: 'string', enum: ['off', 'allow', 'warn', 'error', 'deny'] },
    { type: 'integer', minimum: 0, maximum: 2 },
    { type: 'array', description: 'Rule with options: [severity, ...options]' },
  ],
};

const ruleProperties: Record<string, unknown> = {};
for (const rule of oxlintRules) {
  ruleProperties[rule.qualified] = {
    description: `[${rule.category}] ${rule.qualified}`,
    ...ruleValueSchema,
  };
}

// ─── Enrich descriptions ─────────────────────────────────────────────────────

const DESCRIPTIONS: Record<string, string> = {
  workspace: 'Workspace name, used in generated package names and CLI output.',
  ecosystems: 'Language ecosystems and their packages.',
  bridges: 'Cross-ecosystem dependencies linked by a shared artifact.',
  env: 'Environment variable parity across packages.',
  format: 'Per-ecosystem formatting. neutron picks the right formatter: TypeScript → oxfmt, Dart → dart format.',
  lint: 'Per-ecosystem linting. neutron picks the right linter: TypeScript → oxlint, Dart → dart analyze. Plugins auto-enabled based on dependencies.',
  hooks: 'Git hooks installed by `neutron install`. Each hook is a list of shell commands. Set to `false` to disable.',
  commits: 'Conventional commit validation, enforced by neutron\'s commit-msg git hook.',
};

// Apply descriptions to top-level properties
for (const [key, desc] of Object.entries(DESCRIPTIONS)) {
  const prop = baseSchema.properties[key];
  if (prop) {
    prop['description'] = desc;
  }
}

// Enrich lint.typescript.rules with oxlint rule autocomplete
const lintProp = baseSchema.properties['lint'] as JsonSchema | undefined;
if (lintProp) {
  const lintProps = lintProp['properties'] as Record<string, JsonSchema> | undefined;
  if (lintProps?.['typescript']) {
    const tsLint = lintProps['typescript'] as JsonSchema;
    const tsLintProps = tsLint['properties'] as Record<string, JsonSchema> | undefined;
    if (tsLintProps?.['rules']) {
      tsLintProps['rules'] = {
        type: 'object',
        description: 'Individual rule overrides. Keys are qualified rule names (e.g. "eslint/eqeqeq").',
        properties: ruleProperties,
        additionalProperties: ruleValueSchema,
      };
    }

    // Enrich category descriptions
    if (tsLintProps?.['categories']) {
      const cats = tsLintProps['categories'] as JsonSchema;
      const catProps = cats['properties'] as Record<string, JsonSchema> | undefined;
      if (catProps) {
        const catDescs: Record<string, string> = {
          correctness: 'Code that is outright wrong or useless.',
          suspicious: 'Code that is most likely wrong.',
          pedantic: 'Strict rules, occasional false positives.',
          perf: 'Code that could be more performant.',
          style: 'Code style consistency.',
          restriction: 'Prevents specific language features.',
          nursery: 'Experimental rules under development.',
        };
        for (const [cat, desc] of Object.entries(catDescs)) {
          if (catProps[cat]) {
            catProps[cat]['description'] = desc;
          }
        }
      }
    }
  }
}

// ─── Assemble and write ──────────────────────────────────────────────────────

const neutronSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'neutron.yml',
  description: 'neutron workspace configuration — cross-ecosystem monorepo tool',
  ...baseSchema,
};

const outputPath = join(ROOT, 'schema.json');
writeFileSync(outputPath, JSON.stringify(neutronSchema, null, 2) + '\n', 'utf-8');

const size = (readFileSync(outputPath).length / 1024).toFixed(1);
console.log(`schema.json generated (${size} KB)`);
