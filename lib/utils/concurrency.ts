/**
 * Bounded-concurrency helpers.
 *
 * Extracted from `app/api/market/returns/route.ts` (the only call site that had a pool) so every
 * fan-out over Yahoo Finance goes through ONE primitive. Before this, `fetchBatchQuotes` fired
 * `Promise.allSettled(tickers.map(...))` with no bound — a 475-ticker Beating-Peers union opened
 * 475 concurrent sockets in a single request, which is both a self-inflicted DoS on our own
 * function and a reliable way to earn a Yahoo 429 for the whole batch.
 *
 * Both helpers preserve INPUT ORDER in the result array (`results[i]` corresponds to `items[i]`).
 */

/** Clamp a caller-supplied limit into a sane range. `0`/`NaN`/negatives would deadlock the pool. */
function normalizeLimit(limit: number, itemCount: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 1
  return Math.min(Math.floor(limit), itemCount)
}

/**
 * Runs `fn` over `items` with at most `limit` in flight.
 *
 * Rejection semantics match `Promise.all`: the first rejection propagates (and in-flight workers
 * are not cancelled). This is the exact behaviour the returns route relied on — its `fn` is
 * null-safe and never throws. If you need per-item isolation, use `mapSettledWithConcurrency`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  if (items.length === 0) return results

  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i], i)
    }
  }

  await Promise.all(Array.from({ length: normalizeLimit(limit, items.length) }, worker))
  return results
}

/**
 * Same pool, `Promise.allSettled` semantics: one item's rejection never aborts the rest.
 * Used by `fetchBatchQuotes`, which must return whatever it managed to fetch.
 */
export async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  if (items.length === 0) return results

  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: normalizeLimit(limit, items.length) }, worker))
  return results
}
