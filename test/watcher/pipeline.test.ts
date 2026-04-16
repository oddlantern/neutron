import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import type { ExecutablePipelineStep, ExecuteResult } from '../../src/plugins/types.js';
import { runPipeline } from '../../src/bridges/pipeline.js';

function makeTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'neutron-test-pipeline-')));
}

function makeStep(overrides: {
  name?: string;
  success?: boolean;
  duration?: number;
  output?: string;
  outputPaths?: readonly string[];
  sideEffect?: () => void;
}): ExecutablePipelineStep {
  return {
    name: overrides.name ?? 'test-step',
    plugin: 'test',
    description: 'test step',
    outputPaths: overrides.outputPaths,
    execute: async (): Promise<ExecuteResult> => {
      overrides.sideEffect?.();
      return {
        success: overrides.success ?? true,
        duration: overrides.duration ?? 10,
        summary: 'done',
        output: overrides.output,
      };
    },
  };
}

describe('runPipeline', () => {
  test('single step succeeds — result.success true, 1 step result', async () => {
    const root = makeTempDir();
    const step = makeStep({ name: 'only-step', success: true, duration: 42 });

    const result = await runPipeline([step], root);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.step.name).toBe('only-step');
    expect(result.steps[0]!.success).toBe(true);
  });

  test('multi-step pipeline stops on first failure', async () => {
    const root = makeTempDir();
    let thirdRan = false;

    const steps = [
      makeStep({ name: 'step-1', success: true }),
      makeStep({ name: 'step-2', success: false }),
      makeStep({
        name: 'step-3',
        success: true,
        sideEffect: () => {
          thirdRan = true;
        },
      }),
    ];

    const result = await runPipeline(steps, root);

    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]!.success).toBe(true);
    expect(result.steps[1]!.success).toBe(false);
    expect(thirdRan).toBe(false);
  });

  test('changed: true when output file content changes between before/after', async () => {
    const root = makeTempDir();
    const outputFile = 'output.txt';
    const absPath = join(root, outputFile);

    // Write initial content before the step runs
    writeFileSync(absPath, 'before-content');

    const step = makeStep({
      outputPaths: [outputFile],
      sideEffect: () => {
        // Modify the file during execution
        writeFileSync(absPath, 'after-content');
      },
    });

    const result = await runPipeline([step], root);

    expect(result.success).toBe(true);
    expect(result.steps[0]!.changed).toBe(true);
  });

  test('changed: false when output file content is unchanged', async () => {
    const root = makeTempDir();
    const outputFile = 'stable.txt';
    const absPath = join(root, outputFile);

    // Write content that the step will NOT modify
    writeFileSync(absPath, 'same-content');

    const step = makeStep({
      outputPaths: [outputFile],
      // No sideEffect — file stays the same
    });

    const result = await runPipeline([step], root);

    expect(result.success).toBe(true);
    expect(result.steps[0]!.changed).toBe(false);
  });

  test('changed: true when no outputPaths defined (default behavior)', async () => {
    const root = makeTempDir();

    const step = makeStep({
      // No outputPaths
    });

    const result = await runPipeline([step], root);

    expect(result.success).toBe(true);
    expect(result.steps[0]!.changed).toBe(true);
  });

  test('total duration accumulates across steps', async () => {
    const root = makeTempDir();

    const steps = [
      makeStep({ duration: 15 }),
      makeStep({ duration: 25 }),
      makeStep({ duration: 10 }),
    ];

    const result = await runPipeline(steps, root);

    expect(result.success).toBe(true);
    expect(result.totalDuration).toBe(50);
  });
});
