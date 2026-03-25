import { spawn } from 'node:child_process';

import type { ExecuteResult } from '../types.js';

/** Maximum bytes of stdout/stderr to accumulate per process */
const MAX_OUTPUT_BYTES = 1024 * 1024;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Spawn a command and collect its output.
 * Does NOT use shell: true — arguments are passed directly to the executable.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<ExecuteResult> {
  const start = performance.now();

  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks: string[] = [];
    let totalBytes = 0;

    child.stdout.on('data', (data: Buffer) => {
      if (totalBytes < MAX_OUTPUT_BYTES) {
        chunks.push(data.toString());
        totalBytes += data.length;
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      if (totalBytes < MAX_OUTPUT_BYTES) {
        chunks.push(data.toString());
        totalBytes += data.length;
      }
    });

    child.on('close', (code) => {
      const duration = Math.round(performance.now() - start);
      const output = chunks.join('');

      if (code === 0) {
        resolve({
          success: true,
          duration,
          summary: `${command} ${args.join(' ')} completed`,
          output,
        });
      } else {
        resolve({
          success: false,
          duration,
          summary: `${command} ${args.join(' ')} failed (exit ${String(code)})`,
          output,
        });
      }
    });

    child.on('error', (err: Error) => {
      const duration = Math.round(performance.now() - start);
      resolve({
        success: false,
        duration,
        summary: `Failed to spawn: ${err.message}`,
        output: err.message,
      });
    });
  });
}
