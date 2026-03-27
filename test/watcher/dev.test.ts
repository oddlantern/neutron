import { existsSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { afterEach, describe, expect, test } from 'bun:test';

const MIDO_BIN = join(import.meta.dirname, '..', '..', 'dist', 'bin.js');
const TIMEOUT_MS = 10_000;

function makeTempWorkspace(): string {
  // realpathSync resolves macOS /var → /private/var symlink
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mido-test-dev-')));

  // Create a package that has a "generate" script
  const pkgDir = join(root, 'packages', 'source');
  const srcDir = join(pkgDir, 'src');
  mkdirSync(srcDir, { recursive: true });

  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: 'test-source',
      version: '1.0.0',
      scripts: {
        generate: 'echo done > output.txt',
      },
    }),
  );

  // Create a stub source file so the directory isn't empty
  writeFileSync(join(srcDir, 'index.ts'), '// source');

  // Create the target package
  const targetDir = join(root, 'packages', 'target');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(
    join(targetDir, 'package.json'),
    JSON.stringify({
      name: 'test-target',
      version: '1.0.0',
    }),
  );

  // Create a bridge artifact placeholder
  writeFileSync(join(pkgDir, 'artifact.json'), '{}');

  // Create mido.yml
  const config = [
    'workspace: test-workspace',
    'ecosystems:',
    '  typescript:',
    '    manifest: package.json',
    '    packages:',
    '      - packages/source',
    '      - packages/target',
    'bridges:',
    '  - source: packages/source',
    '    consumers:',
    '      - packages/target',
    '    artifact: packages/source/artifact.json',
    '    run: generate',
    '    watch:',
    '      - packages/source/src/**',
  ].join('\n');

  writeFileSync(join(root, 'mido.yml'), config);

  return root;
}

describe('mido dev integration', () => {
  let child: ReturnType<typeof spawn> | undefined;

  afterEach(() => {
    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
  });

  test(
    'watches files and runs pipeline on change',
    async () => {
      const root = makeTempWorkspace();
      const outputFile = join(root, 'packages', 'source', 'output.txt');

      // Start mido dev
      child = spawn('node', [MIDO_BIN, 'dev', '--verbose'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdout: string[] = [];
      child.stdout?.on('data', (data: Buffer) => {
        stdout.push(data.toString());
      });
      child.stderr?.on('data', (data: Buffer) => {
        stdout.push(data.toString());
      });

      // Wait for chokidar to be ready by watching for the ready log
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timed out waiting for watcher to be ready'));
        }, 5000);

        const check = (): void => {
          const combined = stdout.join('');
          if (combined.includes('chokidar ready')) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });

      // Give chokidar time to finish setting up native watchers
      await new Promise((r) => setTimeout(r, 500));

      // Modify an existing file to trigger a change event (more reliable than add)
      const triggerFile = join(root, 'packages', 'source', 'src', 'index.ts');
      writeFileSync(triggerFile, '// trigger change ' + Date.now());

      // Wait for the pipeline to complete — look for "synced" or output file
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const combined = stdout.join('');
          reject(
            new Error(
              `Pipeline did not fire within 5s.\n\nCaptured output:\n${combined}`,
            ),
          );
        }, 5000);

        const check = (): void => {
          if (existsSync(outputFile)) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 200);
          }
        };
        check();
      });

      // Assertions
      expect(existsSync(outputFile)).toBe(true);

      const combined = stdout.join('');
      expect(combined).toContain('changes in');
      expect(combined).toContain('synced');

      // Cleanup
      child.kill('SIGTERM');
    },
    TIMEOUT_MS,
  );

  test(
    'shows verbose chokidar paths when --verbose is set',
    async () => {
      const root = makeTempWorkspace();

      child = spawn('node', [MIDO_BIN, 'dev', '--verbose'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdout: string[] = [];
      child.stdout?.on('data', (data: Buffer) => {
        stdout.push(data.toString());
      });

      // Wait for ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timed out waiting for verbose output'));
        }, 5000);

        const check = (): void => {
          const combined = stdout.join('');
          if (combined.includes('chokidar ready')) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });

      const combined = stdout.join('');
      expect(combined).toContain('[verbose]');
      expect(combined).toContain('chokidar watching');
      expect(combined).toContain('workspace root:');
      expect(combined).toContain('package manager:');

      child.kill('SIGTERM');
    },
    TIMEOUT_MS,
  );
});
