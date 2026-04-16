import { DiagnosticCollector, formatDiagnostics } from "@/diagnostic";
import type { ParserRegistry } from "@/graph/workspace";
import { BOLD, DIM, FAIL, GREEN, PASS, RESET } from "@/output";

export interface CiOptions {
  readonly verbose?: boolean | undefined;
}

interface StepResult {
  readonly name: string;
  readonly exitCode: number;
  readonly duration: number;
}

const MS_PER_SECOND = 1000;

/**
 * Run the full CI pipeline: generate → build → lint → test → check.
 *
 * Each step runs sequentially. Stops on first failure.
 *
 * @returns exit code (0 = all passed, 1 = failure)
 */
export async function runCi(parsers: ParserRegistry, options: CiOptions = {}): Promise<number> {
  const { verbose = false } = options;

  console.log(`\n${BOLD}neutron ci${RESET} ${DIM}— full pipeline${RESET}\n`);

  const diag = new DiagnosticCollector();
  const results: StepResult[] = [];

  const steps: ReadonlyArray<{
    readonly name: string;
    readonly run: () => Promise<number>;
  }> = [
    {
      name: "generate",
      run: async () => {
        const { runGenerate } = await import("@/commands/generate");
        return runGenerate(parsers, { quiet: true, verbose });
      },
    },
    {
      name: "build",
      run: async () => {
        const { runBuild } = await import("@/commands/build");
        return runBuild(parsers, { quiet: true });
      },
    },
    {
      name: "lint",
      run: async () => {
        const { runLint } = await import("@/commands/lint");
        return runLint(parsers, { quiet: true });
      },
    },
    {
      name: "test",
      run: async () => {
        const { runTest } = await import("@/commands/test");
        return runTest(parsers, { quiet: true });
      },
    },
    {
      name: "check",
      run: async () => {
        const { runCheck } = await import("@/commands/check");
        return runCheck(parsers, { quiet: true });
      },
    },
  ];

  for (const step of steps) {
    const start = performance.now();
    console.log(`  ${DIM}▸${RESET} ${step.name}...`);

    const exitCode = await step.run();
    const duration = Math.round(performance.now() - start);
    results.push({ name: step.name, exitCode, duration });

    const icon = exitCode === 0 ? PASS : FAIL;
    const ms =
      duration >= MS_PER_SECOND ? `${(duration / MS_PER_SECOND).toFixed(1)}s` : `${duration}ms`;
    console.log(`  ${icon} ${step.name} (${ms})`);

    if (exitCode !== 0) {
      diag.error(`${step.name} failed`, {
        detail: `exit code ${exitCode}`,
        fix: `Run neutron ${step.name} for full output`,
      });
      break;
    }
  }

  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const totalMs =
    totalDuration >= MS_PER_SECOND
      ? `${(totalDuration / MS_PER_SECOND).toFixed(1)}s`
      : `${totalDuration}ms`;

  if (!diag.hasErrors) {
    console.log(`\n${GREEN}${BOLD}CI passed${RESET} ${DIM}(${totalMs})${RESET}`);
  }

  console.log(formatDiagnostics(diag, steps.length));
  return diag.hasErrors ? 1 : 0;
}
