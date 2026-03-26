import { describe, expect, test } from 'bun:test';

import { configSchema } from '../../src/config/schema.js';

const MINIMAL_VALID = {
  workspace: 'my-workspace',
  ecosystems: {
    typescript: {
      manifest: 'package.json',
      packages: ['packages/lib'],
    },
  },
};

describe('configSchema', () => {
  test('valid minimal config passes', () => {
    const result = configSchema.safeParse(MINIMAL_VALID);
    expect(result.success).toBe(true);
  });

  test('missing workspace field fails', () => {
    const result = configSchema.safeParse({
      ecosystems: {
        typescript: {
          manifest: 'package.json',
          packages: ['packages/lib'],
        },
      },
    });
    expect(result.success).toBe(false);
  });

  test('missing ecosystems field fails', () => {
    const result = configSchema.safeParse({
      workspace: 'test',
    });
    expect(result.success).toBe(false);
  });

  test('empty ecosystems object fails (at least one required)', () => {
    const result = configSchema.safeParse({
      workspace: 'test',
      ecosystems: {},
    });
    expect(result.success).toBe(false);
  });

  test('ecosystem with empty packages array fails', () => {
    const result = configSchema.safeParse({
      workspace: 'test',
      ecosystems: {
        typescript: {
          manifest: 'package.json',
          packages: [],
        },
      },
    });
    expect(result.success).toBe(false);
  });

  test('bridge with source/target/artifact passes', () => {
    const result = configSchema.safeParse({
      ...MINIMAL_VALID,
      bridges: [
        {
          source: 'apps/server',
          target: 'apps/flutter',
          artifact: 'apps/server/openapi.json',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('bridge with optional fields passes', () => {
    const result = configSchema.safeParse({
      ...MINIMAL_VALID,
      bridges: [
        {
          source: 'apps/server',
          target: 'apps/flutter',
          artifact: 'openapi.json',
          run: 'bun generate',
          watch: ['src/**/*.ts'],
          entryFile: 'src/index.ts',
          specPath: '/api/docs',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('lint config with typescript categories validates', () => {
    const result = configSchema.safeParse({
      ...MINIMAL_VALID,
      lint: {
        typescript: {
          categories: {
            correctness: 'error',
            suspicious: 'warn',
            pedantic: 'off',
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test('lint config with invalid category level fails', () => {
    const result = configSchema.safeParse({
      ...MINIMAL_VALID,
      lint: {
        typescript: {
          categories: {
            correctness: 'invalid-level',
          },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  test('format config with typescript options validates', () => {
    const result = configSchema.safeParse({
      ...MINIMAL_VALID,
      format: {
        typescript: {
          printWidth: 100,
          useTabs: false,
          semi: true,
          singleQuote: true,
          trailingComma: 'all',
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test('format config with ignore patterns validates', () => {
    const result = configSchema.safeParse({
      ...MINIMAL_VALID,
      format: {
        ignore: ['dist/**', 'node_modules/**'],
      },
    });
    expect(result.success).toBe(true);
  });

  test('commits config with defaults validates', () => {
    const result = configSchema.safeParse({
      ...MINIMAL_VALID,
      commits: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.commits!.types).toContain('feat');
      expect(result.data.commits!.header_max_length).toBe(100);
    }
  });

  test('commits config with custom scopes validates', () => {
    const result = configSchema.safeParse({
      ...MINIMAL_VALID,
      commits: {
        scopes: ['config', 'graph', 'cli'],
      },
    });
    expect(result.success).toBe(true);
  });
});
