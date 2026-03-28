import { CYAN, DIM, GREEN, MAGENTA, RED, RESET } from "../output.js";

const MS_PER_SECOND = 1000;
const MAX_OUTPUT_LINES = 15;

export function formatMs(ms: number): string {
  return ms >= MS_PER_SECOND ? `${(ms / MS_PER_SECOND).toFixed(1)}s` : `${ms}ms`;
}

export function log(icon: string, message: string): void {
  console.log(`  ${icon} ${message}`);
}

export function logStep(message: string): void {
  log(`${DIM}\u25C7${RESET}`, `${DIM}${message}${RESET}`);
}

export function logSuccess(message: string): void {
  log(`${GREEN}\u2713${RESET}`, `${GREEN}${message}${RESET}`);
}

export function logFail(message: string): void {
  log(`${RED}\u2717${RESET}`, `${RED}${message}${RESET}`);
}

export function logChange(path: string): void {
  log(`${CYAN}\u25CB${RESET}`, `changes in ${DIM}${path}${RESET}`);
}

export function logWaiting(): void {
  log(`${DIM}\u2298${RESET}`, `${DIM}waiting for next change...${RESET}`);
}

export function logUnchanged(message: string): void {
  log(`${DIM}\u00B7${RESET}`, `${DIM}${message}${RESET}`);
}

export function logOutput(output: string): void {
  const lines = output.trim().split("\n");
  const shown = lines.slice(0, MAX_OUTPUT_LINES);
  for (const line of shown) {
    console.log(`    ${DIM}${line}${RESET}`);
  }
  if (lines.length > MAX_OUTPUT_LINES) {
    console.log(`    ${DIM}... ${lines.length - MAX_OUTPUT_LINES} more line(s)${RESET}`);
  }
}

export function logDebug(message: string): void {
  console.log(`  ${MAGENTA}[verbose]${RESET} ${DIM}${message}${RESET}`);
}
