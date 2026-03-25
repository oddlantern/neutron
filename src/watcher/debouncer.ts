export interface Debouncer {
  trigger(): void;
  cancel(): void;
}

const DEFAULT_DELAY_MS = 2000;

/**
 * Create a debouncer that fires the callback after a quiet period.
 * Each trigger() call resets the timer. Only fires once per quiet period.
 */
export function createDebouncer(
  callback: () => void,
  delayMs: number = DEFAULT_DELAY_MS,
): Debouncer {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    trigger(): void {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        callback();
      }, delayMs);
    },
    cancel(): void {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
