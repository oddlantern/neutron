import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { EnvConfig } from '../../src/config/schema.js';
import { checkEnvParity } from '../../src/checks/env.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mido-env-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('checkEnvParity', () => {
  test('all shared keys present in all files passes', async () => {
    writeFileSync(join(tmpDir, '.env.server'), 'API_URL=http://localhost:3000\nDB_URL=postgres://...\n');
    writeFileSync(join(tmpDir, '.env.client'), 'API_URL=http://localhost:3000\n');

    const config: EnvConfig = {
      shared: ['API_URL'],
      files: ['.env.server', '.env.client'],
    };

    const result = await checkEnvParity(config, tmpDir);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('missing shared key in one file produces error', async () => {
    writeFileSync(join(tmpDir, '.env.server'), 'API_URL=http://localhost:3000\nDB_URL=postgres://...\n');
    writeFileSync(join(tmpDir, '.env.client'), 'DB_URL=something\n');
    // .env.client is missing API_URL

    const config: EnvConfig = {
      shared: ['API_URL'],
      files: ['.env.server', '.env.client'],
    };

    const result = await checkEnvParity(config, tmpDir);
    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.severity).toBe('error');
    expect(result.issues[0]?.message).toContain('API_URL');
    expect(result.issues[0]?.message).toContain('.env.client');
  });

  test('env file with comments and blank lines is parsed correctly', async () => {
    const content = [
      '# This is a comment',
      '',
      'API_URL=http://localhost:3000',
      '  # Indented comment',
      'SECRET_KEY=abc123',
    ].join('\n');

    writeFileSync(join(tmpDir, '.env.a'), content);
    writeFileSync(join(tmpDir, '.env.b'), 'API_URL=other\nSECRET_KEY=xyz\n');

    const config: EnvConfig = {
      shared: ['API_URL', 'SECRET_KEY'],
      files: ['.env.a', '.env.b'],
    };

    const result = await checkEnvParity(config, tmpDir);
    expect(result.passed).toBe(true);
  });

  test('missing env file itself produces error', async () => {
    writeFileSync(join(tmpDir, '.env.server'), 'API_URL=http://localhost:3000\n');
    // .env.missing does not exist

    const config: EnvConfig = {
      shared: ['API_URL'],
      files: ['.env.server', '.env.missing'],
    };

    const result = await checkEnvParity(config, tmpDir);
    expect(result.passed).toBe(false);
    const fileIssue = result.issues.find((i) => i.message.includes('.env.missing'));
    expect(fileIssue).toBeDefined();
    expect(fileIssue?.severity).toBe('error');
  });

  test('multiple missing keys produce multiple errors', async () => {
    writeFileSync(join(tmpDir, '.env.a'), 'API_URL=x\nDB_URL=y\n');
    writeFileSync(join(tmpDir, '.env.b'), 'UNRELATED=z\n');

    const config: EnvConfig = {
      shared: ['API_URL', 'DB_URL'],
      files: ['.env.a', '.env.b'],
    };

    const result = await checkEnvParity(config, tmpDir);
    expect(result.passed).toBe(false);
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  test('summary reflects success when all keys present', async () => {
    writeFileSync(join(tmpDir, '.env.a'), 'KEY=val\n');
    writeFileSync(join(tmpDir, '.env.b'), 'KEY=other\n');

    const config: EnvConfig = {
      shared: ['KEY'],
      files: ['.env.a', '.env.b'],
    };

    const result = await checkEnvParity(config, tmpDir);
    expect(result.summary).toContain('verified');
  });
});
