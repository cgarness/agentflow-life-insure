/**
 * Request lifetime for a load made of several reads.
 *
 * `Promise.all` rejects as soon as one read fails, while its sibling reads are
 * still on the wire — so whatever serializes the load (a Dashboard section's
 * lane) believes it is done and may send the next load on top of them. These
 * helpers keep a load alive until every read it started has really settled
 * (answered, or its cancellation confirmed), and cancel the siblings as soon as
 * one fails so that happens quickly.
 */

/**
 * Like `Promise.all`, but never settles before EVERY promise has settled. On
 * failure it rejects with the chronologically FIRST failure, and calls
 * `onFirstFailure` right away (e.g. to cancel the sibling reads).
 */
export async function settleAll<T extends readonly unknown[] | []>(
  promises: T,
  onFirstFailure?: (reason: unknown) => void,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const first: { failed: boolean; reason: unknown } = { failed: false, reason: undefined };
  const settled = await Promise.allSettled(
    (promises as readonly unknown[]).map((promise) =>
      Promise.resolve(promise).catch((reason: unknown) => {
        if (!first.failed) {
          first.failed = true;
          first.reason = reason;
          onFirstFailure?.(reason);
        }
        throw reason;
      }),
    ),
  );
  if (first.failed) throw first.reason;
  return settled.map((result) => (result as PromiseFulfilledResult<unknown>).value) as {
    -readonly [K in keyof T]: Awaited<T[K]>;
  };
}

/**
 * One load's cancellation: aborted by `abort()` (first failure) or when the
 * caller's `signal` aborts. `dispose()` detaches from the caller's signal.
 */
export function linkedAbort(signal?: AbortSignal | null) {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onCallerAbort, { once: true });
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    dispose: () => signal?.removeEventListener("abort", onCallerAbort),
  };
}
