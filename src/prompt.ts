import { readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createInterface, type Interface, type CompleterResult } from 'node:readline';

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

let rl: Interface | null = null;
let bufferedLines: string[] | null = null;
let lineIndex = 0;

function ensureReadline(): Interface {
  if (rl) {
    return rl;
  }

  rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY === true,
  });

  return rl;
}

async function bufferStdin(): Promise<void> {
  if (bufferedLines) {
    return;
  }
  if (process.stdin.isTTY) {
    return;
  }

  bufferedLines = [];
  const iface = ensureReadline();

  return new Promise<void>((resolve) => {
    iface.on('line', (line: string) => {
      bufferedLines?.push(line);
    });
    iface.on('close', () => {
      resolve();
    });
  });
}

export function ask(question: string): Promise<string> {
  if (bufferedLines) {
    // Piped input mode — print the question, return next buffered line
    process.stdout.write(question);
    const line = bufferedLines[lineIndex] ?? '';
    lineIndex++;
    process.stdout.write(line + '\n');
    return Promise.resolve(line);
  }

  const iface = ensureReadline();
  return new Promise<string>((resolve) => {
    iface.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export async function promptVersionResolution(
  depName: string,
  choices: readonly DepChoice[],
  lockedRange: string | undefined,
): Promise<VersionResolution | null> {
  await bufferStdin();

  const ranges = [...new Set(choices.map((c) => c.range))];
  const totalPackages = choices.length;

  console.log(`\n  ${depName} — ${totalPackages} packages, ${ranges.length} ranges`);

  if (lockedRange) {
    console.log(`  locked: ${lockedRange}`);
  }

  console.log('');

  for (let i = 0; i < choices.length; i++) {
    const c = choices[i];
    if (!c) {
      continue;
    }
    console.log(`    ${i + 1}) ${c.range}  ← ${c.packagePath} (${c.ecosystem}) [${c.type}]`);
  }

  console.log('    s) skip');
  console.log('    c) custom range');
  console.log('');

  const answer = await ask('    Pick: ');

  if (answer === 's') {
    return null;
  }

  let chosenRange: string;

  if (answer === 'c') {
    chosenRange = await ask('    Custom range: ');
    if (chosenRange === '') {
      return null;
    }
  } else {
    const idx = parseInt(answer, 10);
    if (isNaN(idx) || idx < 1 || idx > choices.length) {
      console.log('    Invalid choice, skipping.');
      return null;
    }
    const picked = choices[idx - 1];
    if (!picked) {
      console.log('    Invalid choice, skipping.');
      return null;
    }
    chosenRange = picked.range;
  }

  // Targets = packages whose range differs from the chosen one
  const targets = choices.filter((c) => c.range !== chosenRange);

  return { depName, chosenRange, targets };
}

function pathCompleter(root: string): (line: string) => CompleterResult {
  return (line: string): CompleterResult => {
    const partial = line;
    const dir = partial.includes('/') ? dirname(partial) : '.';
    const prefix = partial.includes('/') ? basename(partial) : partial;
    const absDir = join(root, dir);

    let entries: string[];
    try {
      entries = readdirSync(absDir);
    } catch {
      return [[], line];
    }

    const matches = entries
      .filter((e) => e.startsWith(prefix) && !e.startsWith('.'))
      .map((e) => {
        const full = join(absDir, e);
        let isDir = false;
        try {
          isDir = statSync(full).isDirectory();
        } catch {
          // treat as file
        }
        const rel = dir === '.' ? e : `${dir}/${e}`;
        return isDir ? `${rel}/` : rel;
      });

    return [matches, line];
  };
}

/**
 * Ask for a file path with tab-completion relative to the given root.
 * Spawns a temporary readline instance with a completer, then restores
 * the shared one.
 */
export function askPath(question: string, root: string): Promise<string> {
  if (bufferedLines) {
    process.stdout.write(question);
    const line = bufferedLines[lineIndex] ?? '';
    lineIndex++;
    process.stdout.write(line + '\n');
    return Promise.resolve(line);
  }

  // Pause the shared readline so we can take over stdin
  if (rl) {
    rl.close();
    rl = null;
  }

  const completer = pathCompleter(root);
  const pathRl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY === true,
    completer,
  });

  return new Promise<string>((resolve) => {
    pathRl.question(question, (answer) => {
      pathRl.close();
      resolve(answer.trim());
    });
  });
}

export function closePrompt(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
  bufferedLines = null;
  lineIndex = 0;
}
