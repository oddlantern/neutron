import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { runCommand } from '../../src/plugins/builtin/exec.js';

function makeTempDir(): string {
  // realpathSync resolves macOS /var → /private/var symlink
  return realpathSync(mkdtempSync(join(tmpdir(), 'mido-test-pipeline-')));
}

describe('runCommand', () => {
  test('executes a command in the correct directory', async () => {
    const cwd = makeTempDir();
    const result = await runCommand('pwd', [], cwd);

    expect(result.success).toBe(true);
    expect(result.output?.trim()).toBe(cwd);
  });

  test('returns success with duration on exit code 0', async () => {
    const cwd = makeTempDir();
    const result = await runCommand('echo', ['hello'], cwd);

    expect(result.success).toBe(true);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.summary).toContain('completed');
    expect(result.output?.trim()).toBe('hello');
  });

  test('returns failure with output on non-zero exit code', async () => {
    const cwd = makeTempDir();
    const result = await runCommand('sh', ['-c', 'echo fail-output && exit 1'], cwd);

    expect(result.success).toBe(false);
    expect(result.summary).toContain('failed');
    expect(result.summary).toContain('exit 1');
    expect(result.output).toContain('fail-output');
  });

  test('captures stderr in output', async () => {
    const cwd = makeTempDir();
    const result = await runCommand('sh', ['-c', 'echo stderr-msg >&2'], cwd);

    expect(result.success).toBe(true);
    expect(result.output).toContain('stderr-msg');
  });

  test('handles command not found gracefully', async () => {
    const cwd = makeTempDir();
    const result = await runCommand('nonexistent-command-xyz', [], cwd);

    expect(result.success).toBe(false);
    expect(result.summary).toContain('Failed to spawn');
  });

  test('captures both stdout and stderr together', async () => {
    const cwd = makeTempDir();
    const result = await runCommand(
      'sh',
      ['-c', 'echo out-first && echo err-second >&2'],
      cwd,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('out-first');
    expect(result.output).toContain('err-second');
  });
});
