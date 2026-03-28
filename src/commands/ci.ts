import type { ParserRegistry } from "../graph/workspace.js";
import { BOLD, DIM, FAIL, GREEN, PASS, RESET } from "../output.js";

export interface CiOptions {
  readonly verbose?: boolean | undefined;
}

interface StepResult {
  readonly name: string;
  readonly exitCode: number;
  readonly duration: number;
}

/**
 * Run the full CI pipeline: generate → build → lint → test → check.
 *
 * Each step runs sequentially. Stops on first failure unless --continue is used.
 * Designed to replace bespoke CI configs with a single `mido ci` command.
 *
 * @returns exit code (0 = all passed, 1 = failure)
 */
export async function runCi(parsers: ParserRegistry, options: CiOptions = {}): Promise<number> {
  const { verbose = false } = options;

  console.log(`\n${BOLD}mido ci${RESET} ${DIM}— full pipeline${RESET}\n`);

  const results: StepResult[] = [];

  const steps: ReadonlyArray<{
    readonly name: string;
    readonly run: () => Promise<number>;
  }> = [
    {
      name: "generate",
      run: async () => {
        const { runGenerate } = await import("./generate.js");
        return runGenerate(parsers, { quiet: true, verbose });
      },
    },
    {
      name: "build",
      run: async () => {
        const { runBuild } = await import("./build.js");
        return runBuild(parsers, { quiet: true });
      },
    },
    {
      name: "lint",
      run: async () => {
        const { runLint } = await import("./lint.js");
        return runLint(parsers, { quiet: true });
      },
    },
    {
      name: "test",
      run: async () => {
        const { runTest } = await import("./test.js");
        return runTest(parsers, { quiet: true });
      },
    },
    {
      name: "check",
      run: async () => {
        const { runCheck } = await import("./check.js");
        return runCheck(parsers, { quiet: true });
      },
    },
  ];

  let failed = false;

  for (const step of steps) {
    const start = performance.now();
    console.log(`  ${DIM}▸${RESET} ${step.name}...`);

    const exitCode = await step.run();
    const duration = Math.round(performance.now() - start);
    results.push({ name: step.name, exitCode, duration });

    const icon = exitCode === 0 ? PASS : FAIL;
    const ms = duration >= 1000 ? `${(duration / 1000).toFixed(1)}s` : `${duration}ms`;
    console.log(`  ${icon} ${step.name} (${ms})`);

    if (exitCode !== 0) {
      failed = true;
      break;
    }
  }

  console.log();

  if (failed) {
    const failedStep = results.find((r) => r.exitCode !== 0);
    console.log(`${FAIL} ${BOLD}CI failed${RESET} at ${failedStep?.name ?? "unknown"}\n`);
    return 1;
  }

  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const totalMs = totalDuration >= 1000 ? `${(totalDuration / 1000).toFixed(1)}s` : `${totalDuration}ms`;
  console.log(`${GREEN}${BOLD}CI passed${RESET} ${DIM}(${totalMs})${RESET}\n`);
  return 0;
}
