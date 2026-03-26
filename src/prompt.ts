import { confirm, isCancel, select, text, cancel } from "@clack/prompts";

export interface DepChoice {
  readonly range: string;
  readonly packagePath: string;
  readonly ecosystem: string;
  readonly type: string;
}

export interface VersionResolution {
  readonly depName: string;
  readonly chosenRange: string;
  /** Packages whose current range differs from the chosen range */
  readonly targets: readonly DepChoice[];
}

function handleCancel(): never {
  cancel("Aborted.");
  process.exit(0);
}

export async function promptVersionResolution(
  depName: string,
  choices: readonly DepChoice[],
  lockedRange: string | undefined,
): Promise<VersionResolution | null> {
  const ranges = [...new Set(choices.map((c) => c.range))];
  const totalPackages = choices.length;

  let message = `${depName} — ${totalPackages} packages, ${ranges.length} ranges`;
  if (lockedRange) {
    message += ` (locked: ${lockedRange})`;
  }

  const options: { value: string; label: string; hint: string }[] = choices.map((c, i) => ({
    value: String(i),
    label: c.range,
    hint: `${c.packagePath} (${c.ecosystem}) [${c.type}]`,
  }));

  options.push({ value: "skip", label: "Skip", hint: "" });
  options.push({ value: "custom", label: "Custom range", hint: "" });

  const answer = await select({ message, options });

  if (isCancel(answer)) {
    handleCancel();
  }

  if (answer === "skip") {
    return null;
  }

  let chosenRange: string;

  if (answer === "custom") {
    const custom = await text({ message: "Custom range:" });
    if (isCancel(custom) || !custom) {
      return null;
    }
    chosenRange = custom;
  } else {
    const idx = parseInt(answer, 10);
    const picked = choices[idx];
    if (!picked) {
      return null;
    }
    chosenRange = picked.range;
  }

  const targets = choices.filter((c) => c.range !== chosenRange);

  return { depName, chosenRange, targets };
}

export async function confirmAction(message: string, defaultValue = true): Promise<boolean> {
  const result = await confirm({ message, initialValue: defaultValue });
  if (isCancel(result)) {
    handleCancel();
  }
  return result;
}

/** No-op — @clack/prompts manages its own lifecycle */
export function closePrompt(): void {
  // Kept for API compatibility
}
