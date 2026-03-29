import type { ParserRegistry } from "@/graph/workspace";
import { FAIL, PASS } from "@/output";
import { runFmt } from "@/commands/fmt";
import { runLint } from "@/commands/lint";
import { runCheck } from "@/commands/check";

interface PreCommitStep {
  readonly name: string;
  readonly run: () => Promise<number>;
}

/**
 * Run the full pre-commit validation suite.
 * Stops on first failure for fast feedback.
 *
 * Order: format check → lint → workspace check
 *
 * @returns exit code (0 = all pass, 1 = any failure)
 */
export async function runPreCommit(parsers: ParserRegistry): Promise<number> {
  const steps: readonly PreCommitStep[] = [
    {
      name: "format",
      run: () => runFmt(parsers, { check: true, quiet: true }),
    },
    {
      name: "lint",
      run: () => runLint(parsers, { quiet: true }),
    },
    {
      name: "workspace",
      run: () => runCheck(parsers, { quiet: true }),
    },
  ];

  for (const step of steps) {
    const exitCode = await step.run();

    if (exitCode !== 0) {
      console.log(`${FAIL} ${step.name}`);
      return 1;
    }

    console.log(`${PASS} ${step.name}`);
  }

  return 0;
}
