/**
 * Debounced autosave for tailored CVs.
 *
 * Every keystroke in the editor dispatches `updateCV`, which persists to
 * localStorage synchronously. If that also PUT to the backend per keystroke,
 * a two-minute edit would be a few hundred API Gateway + DynamoDB writes, and
 * they'd land out of order. So the store marks CVs dirty here and this module
 * flushes them on a debounce.
 *
 * Extracted from the store (rather than inlined) so the debounce and retry
 * behaviour is exercisable without React, a network, or a browser.
 *
 * Three details worth knowing:
 * - There is a max-wait *as well as* a debounce, and they're separate timers.
 *   A user typing continuously resets the debounce on every keystroke, so a
 *   pure trailing debounce would never save until they paused. The max-wait
 *   timer is armed when a batch goes dirty and deliberately not re-armed by
 *   later edits in the same batch.
 * - Flushing happens on `visibilitychange -> hidden`, not `beforeunload`:
 *   `navigator.sendBeacon` can't set an `Authorization` header, so a beacon
 *   flush would be rejected by the API Gateway JWT authorizer. Hiding the tab
 *   is the last reliable moment we can still make an authenticated async call.
 * - A failed save is re-queued with exponential backoff rather than dropped.
 *   localStorage still holds the edit either way, so nothing is lost — the
 *   backoff just stops a dead network from being hammered.
 */

export const DEBOUNCE_MS = 1500;
/** Cap on how long a continuously-edited CV can go unsaved. */
export const MAX_WAIT_MS = 10_000;
/** First retry delay after a failed flush; doubles up to MAX_BACKOFF_MS. */
export const RETRY_BASE_MS = 2000;
export const MAX_BACKOFF_MS = 60_000;

export interface SyncOptions {
  /** Push one CV. Resolves on success; rejects to trigger a retry. */
  save: (cvId: string) => Promise<void>;
  /** Called with the cvIds currently being written, so the UI can show a
   * "Saving…" state. */
  onStateChange?: (cvIds: Set<string>) => void;
  /** Called when a CV fails to save, so the UI can surface it. */
  onError?: (cvId: string, error: unknown) => void;
  debounceMs?: number;
  maxWaitMs?: number;
  retryBaseMs?: number;
  maxBackoffMs?: number;
  /** Injected for tests; defaults to the global timer functions. */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export class CVSync {
  private dirty = new Set<string>();
  /** cvId -> current retry backoff, cleared on a fresh edit. */
  private backoff = new Map<string, number>();

  private debounceTimer: unknown = null;
  private maxWaitTimer: unknown = null;
  private retryTimer: unknown = null;
  private flushing = false;
  private stopped = false;

  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly retryBaseMs: number;
  private readonly maxBackoffMs: number;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;

  constructor(private options: SyncOptions) {
    this.debounceMs = options.debounceMs ?? DEBOUNCE_MS;
    this.maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;
    this.retryBaseMs = options.retryBaseMs ?? RETRY_BASE_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;
    this.setTimeoutFn = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn =
      options.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Mark a CV as needing a push. Safe to call on every keystroke. */
  markDirty(cvId: string): void {
    if (this.stopped) return;
    const wasClean = !this.dirty.has(cvId);
    this.dirty.add(cvId);
    // Actively editing a CV is a fresh attempt; don't keep escalating its
    // backoff because of an unrelated earlier failure.
    if (wasClean) this.backoff.delete(cvId);
    this.schedule();
  }

  /** CVs still waiting to be pushed. */
  pending(): string[] {
    return [...this.dirty];
  }

  /** Push everything now, ignoring both timers. */
  async flushNow(): Promise<void> {
    this.clearTimers();
    await this.flush();
  }

  /** Cancel timers and drop pending work. Used on sign-out. */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.dirty.clear();
    this.backoff.clear();
    this.options.onStateChange?.(new Set());
  }

  /** Undo `stop`, so a re-login in the same page session resumes autosaving.
   * A one-shot `stop()` would leave the instance permanently deaf otherwise. */
  resume(): void {
    this.stopped = false;
  }

  /** Drop a CV from the dirty set without pushing it — used after a delete,
   * where pushing a removed CV would just recreate it server-side. */
  forget(cvId: string): void {
    this.dirty.delete(cvId);
    this.backoff.delete(cvId);
    if (this.dirty.size === 0) {
      this.clearDebounce();
      this.clearMaxWait();
    }
  }

  private schedule(): void {
    this.clearDebounce();
    this.debounceTimer = this.setTimeoutFn(() => {
      this.debounceTimer = null;
      void this.flush();
    }, this.debounceMs);

    // Armed once per batch: a later keystroke must not push the cap out.
    if (this.maxWaitTimer === null) {
      this.maxWaitTimer = this.setTimeoutFn(() => {
        this.maxWaitTimer = null;
        void this.flush();
      }, this.maxWaitMs);
    }
  }

  private scheduleRetry(delayMs: number): void {
    if (this.stopped) return;
    if (this.retryTimer !== null) this.clearTimeoutFn(this.retryTimer);
    this.retryTimer = this.setTimeoutFn(() => {
      this.retryTimer = null;
      void this.flush();
    }, delayMs);
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      this.clearTimeoutFn(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private clearMaxWait(): void {
    if (this.maxWaitTimer !== null) {
      this.clearTimeoutFn(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearDebounce();
    this.clearMaxWait();
    if (this.retryTimer !== null) {
      this.clearTimeoutFn(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.stopped || this.dirty.size === 0) return;

    this.flushing = true;
    this.clearDebounce();
    this.clearMaxWait();

    const batch = [...this.dirty];
    this.dirty.clear();
    this.options.onStateChange?.(new Set(batch));

    const failed: string[] = [];
    for (const cvId of batch) {
      try {
        await this.options.save(cvId);
        this.backoff.delete(cvId);
      } catch (error) {
        failed.push(cvId);
        this.dirty.add(cvId);
        const next = Math.min(this.maxBackoffMs, (this.backoff.get(cvId) ?? this.retryBaseMs) * 2);
        this.backoff.set(cvId, next);
        this.options.onError?.(cvId, error);
      }
    }

    this.flushing = false;
    this.options.onStateChange?.(new Set());

    if (failed.length > 0) {
      this.scheduleRetry(Math.max(...failed.map((id) => this.backoff.get(id) ?? this.retryBaseMs)));
      return;
    }

    // Anything that went dirty while this flush was in flight needs a timer.
    if (this.dirty.size > 0) this.schedule();
  }
}

/**
 * Flush pending CVs when the tab is hidden. Hiding is the reliable last chance
 * for an authenticated async request — see the module note on why
 * `beforeunload` is unusable. Returns a teardown function.
 */
export function installVisibilityFlush(sync: CVSync): () => void {
  if (typeof document === 'undefined') return () => {};
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') void sync.flushNow();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => document.removeEventListener('visibilitychange', onVisibilityChange);
}
