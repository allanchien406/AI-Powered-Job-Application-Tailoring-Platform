import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CVSync } from './cvSync';

/**
 * cvSync owns the only genuinely tricky part of CV persistence: turning a
 * keystroke stream into a small number of ordered, retried writes. Everything
 * here runs on injected timers, so no real waiting and no network.
 */

/** Minimal controllable clock: run pending timers only when we say so. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();

  return {
    now: () => now,
    setTimeoutFn: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeoutFn: (handle: unknown) => {
      timers.delete(handle as number);
    },
    /** Advance time, firing anything due. */
    advance: async (ms: number) => {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        const [id, timer] = due[0];
        timers.delete(id);
        now = timer.at;
        timer.fn();
        // let any promise chain the callback started settle
        await Promise.resolve();
        await Promise.resolve();
      }
      now = target;
      await Promise.resolve();
    },
    pending: () => timers.size,
  };
}

const flushMicrotasks = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('CVSync', () => {
  let clock: ReturnType<typeof fakeClock>;
  let saved: string[];
  let failures: string[];

  const makeSync = (save?: (cvId: string) => Promise<void>) =>
    new CVSync({
      save: save ?? (async (cvId) => void saved.push(cvId)),
      onError: (cvId) => void failures.push(cvId),
      debounceMs: 1500,
      maxWaitMs: 10_000,
      retryBaseMs: 2000,
      maxBackoffMs: 60_000,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    });

  beforeEach(() => {
    clock = fakeClock();
    saved = [];
    failures = [];
  });

  afterEach(() => vi.useRealTimers());

  it('does not save on the keystroke itself', async () => {
    const sync = makeSync();
    sync.markDirty('a');
    expect(saved).toEqual([]);
    expect(sync.pending()).toEqual(['a']);
  });

  it('saves after the debounce elapses', async () => {
    const sync = makeSync();
    sync.markDirty('a');
    await clock.advance(1499);
    expect(saved).toEqual([]);
    await clock.advance(2);
    expect(saved).toEqual(['a']);
    expect(sync.pending()).toEqual([]);
  });

  it('coalesces a burst of keystrokes into a single save', async () => {
    const sync = makeSync();
    // One keystroke every 400ms for 2s -- 5 edits, debounce never elapses.
    for (let i = 0; i < 5; i++) {
      sync.markDirty('a');
      await clock.advance(400);
    }
    expect(saved).toEqual([]);
    await clock.advance(1500);
    expect(saved).toEqual(['a']);
  });

  it('saves a continuously-typed CV once the max wait is reached', async () => {
    // The whole reason there's a max-wait timer: a pure trailing debounce never
    // fires while the user keeps typing, so a CV could go unsaved indefinitely.
    const sync = makeSync();
    for (let i = 0; i < 20; i++) {
      sync.markDirty('a');
      await clock.advance(400); // 8s total, debounce (1.5s) keeps resetting
    }
    expect(saved).toEqual([]); // 8s < 10s max wait
    await clock.advance(2400); // cross 10s
    expect(saved).toEqual(['a']);
  });

  it('saves each dirty CV once, in one batch', async () => {
    const sync = makeSync();
    sync.markDirty('a');
    sync.markDirty('b');
    sync.markDirty('a');
    await clock.advance(1500);
    expect(saved.sort()).toEqual(['a', 'b']);
  });

  it('re-queues a failed save and retries with growing backoff', async () => {
    let attempts = 0;
    const sync = makeSync(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('network down');
    });

    sync.markDirty('a');
    await clock.advance(1500);
    expect(attempts).toBe(1);
    expect(failures).toEqual(['a']);
    expect(sync.pending()).toEqual(['a']); // not dropped

    await clock.advance(4000); // first backoff is 2s * 2
    expect(attempts).toBe(2);
    expect(sync.pending()).toEqual(['a']);

    await clock.advance(8000); // second backoff 4s * 2
    expect(attempts).toBe(3);
    expect(saved.length).toBe(0);
    expect(sync.pending()).toEqual([]); // finally succeeded
  });

  it('caps the retry backoff', async () => {
    const sync = new CVSync({
      save: async () => {
        throw new Error('always down');
      },
      debounceMs: 1500,
      maxWaitMs: 10_000,
      retryBaseMs: 2000,
      maxBackoffMs: 8000,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    });
    sync.markDirty('a');
    await clock.advance(1500);
    // Backoff should stop growing at maxBackoffMs; advancing far proves no
    // save is scheduled beyond the cap.
    await clock.advance(600_000);
    expect(failures.length).toBeGreaterThan(2);
  });

  it('a successful save clears the CV from the pending set', async () => {
    const sync = makeSync();
    sync.markDirty('a');
    await clock.advance(1500);
    expect(sync.pending()).toEqual([]);
  });

  it('flushNow pushes immediately, ignoring the debounce', async () => {
    const sync = makeSync();
    sync.markDirty('a');
    await sync.flushNow();
    expect(saved).toEqual(['a']);
  });

  it('picks up a CV that went dirty while a flush was in flight', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    const sync = makeSync(async (cvId) => {
      if (first) {
        first = false;
        await gate;
      }
      saved.push(cvId);
    });

    sync.markDirty('a');
    const flushing = sync.flushNow();
    // 'b' is edited while 'a' is still being written.
    sync.markDirty('b');
    release();
    await flushing;
    await flushMicrotasks();
    await clock.advance(1500);
    expect(saved.sort()).toEqual(['a', 'b']);
  });

  it('forget drops a CV without pushing it (used after a delete)', async () => {
    const sync = makeSync();
    sync.markDirty('a');
    sync.forget('a');
    await clock.advance(1500);
    expect(saved).toEqual([]);
  });

  it('stop cancels pending work and prevents further saves', async () => {
    const sync = makeSync();
    sync.markDirty('a');
    sync.stop();
    await clock.advance(1500);
    expect(saved).toEqual([]);
    sync.markDirty('a');
    await clock.advance(1500);
    expect(saved).toEqual([]);
  });

  it('resume re-enables saving after a stop (re-login in one session)', async () => {
    const sync = makeSync();
    sync.stop();
    sync.resume();
    sync.markDirty('a');
    await clock.advance(1500);
    expect(saved).toEqual(['a']);
  });

  it('reports the set of CVs being written', async () => {
    const batches: string[][] = [];
    const sync = new CVSync({
      save: async () => {},
      onStateChange: (ids) => void batches.push([...ids]),
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    });
    sync.markDirty('a');
    await clock.advance(1500);
    expect(batches).toContainEqual(['a']);
    expect(batches[batches.length - 1]).toEqual([]);
  });
});
