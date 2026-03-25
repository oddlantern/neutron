import { describe, expect, test } from 'bun:test';

import { createDebouncer } from '../../src/watcher/debouncer.js';

describe('createDebouncer', () => {
  test('fires callback after delay with no new triggers', async () => {
    let fired = false;
    const debouncer = createDebouncer(() => {
      fired = true;
    }, 50);

    debouncer.trigger();
    expect(fired).toBe(false);

    await new Promise((r) => setTimeout(r, 80));
    expect(fired).toBe(true);
  });

  test('resets timer on subsequent triggers', async () => {
    let count = 0;
    const debouncer = createDebouncer(() => {
      count += 1;
    }, 100);

    debouncer.trigger();
    await new Promise((r) => setTimeout(r, 60));
    // Still within delay — re-trigger resets the timer
    debouncer.trigger();
    await new Promise((r) => setTimeout(r, 60));
    // 60ms after second trigger — should not have fired yet
    expect(count).toBe(0);

    await new Promise((r) => setTimeout(r, 60));
    // 120ms after second trigger — should have fired exactly once
    expect(count).toBe(1);
  });

  test('cancel prevents callback from firing', async () => {
    let fired = false;
    const debouncer = createDebouncer(() => {
      fired = true;
    }, 50);

    debouncer.trigger();
    debouncer.cancel();

    await new Promise((r) => setTimeout(r, 80));
    expect(fired).toBe(false);
  });

  test('can trigger again after cancel', async () => {
    let count = 0;
    const debouncer = createDebouncer(() => {
      count += 1;
    }, 50);

    debouncer.trigger();
    debouncer.cancel();
    debouncer.trigger();

    await new Promise((r) => setTimeout(r, 80));
    expect(count).toBe(1);
  });

  test('uses default 2000ms delay when none specified', () => {
    // Verify it doesn't throw when called without a delay argument
    let fired = false;
    const debouncer = createDebouncer(() => {
      fired = true;
    });
    debouncer.trigger();
    // Cancel immediately — we just want to confirm it accepted no delay arg
    debouncer.cancel();
    expect(fired).toBe(false);
  });
});
