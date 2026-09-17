import { describe, expect, it } from 'vitest'
import { mapSettledWithConcurrency, mapWithConcurrency } from '@/lib/utils/concurrency'

/** Runs `fn` through the pool while tracking the maximum number of simultaneously-active tasks. */
function makeTracker() {
  let active = 0
  let peak = 0
  return {
    get peak() { return peak },
    wrap<T, R>(fn: (item: T, i: number) => Promise<R>) {
      return async (item: T, i: number): Promise<R> => {
        active++
        if (active > peak) peak = active
        try {
          // Yield across a few macrotask turns so overlap is real, not an artifact of one tick.
          await new Promise((r) => setTimeout(r, 5))
          return await fn(item, i)
        } finally {
          active--
        }
      }
    },
  }
}

describe('mapWithConcurrency', () => {
  it('preserves input order in the results', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      await new Promise((r) => setTimeout(r, (6 - n) * 3))
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50])
  })

  it('never exceeds the concurrency limit', async () => {
    const t = makeTracker()
    const items = Array.from({ length: 40 }, (_, i) => i)
    await mapWithConcurrency(items, 4, t.wrap(async (n: number) => n))
    expect(t.peak).toBeLessThanOrEqual(4)
    // Sanity: the pool must actually be parallel, otherwise "<= 4" would pass trivially.
    expect(t.peak).toBeGreaterThan(1)
  })

  it('caps the pool at the item count when the limit is larger', async () => {
    const t = makeTracker()
    await mapWithConcurrency([1, 2], 50, t.wrap(async (n: number) => n))
    expect(t.peak).toBeLessThanOrEqual(2)
  })

  it('treats a degenerate limit as serial rather than deadlocking', async () => {
    const t = makeTracker()
    const out = await mapWithConcurrency([1, 2, 3], 0, t.wrap(async (n: number) => n))
    expect(out).toEqual([1, 2, 3])
    expect(t.peak).toBe(1)

    const out2 = await mapWithConcurrency([1, 2, 3], Number.NaN, async (n) => n)
    expect(out2).toEqual([1, 2, 3])
  })

  it('returns [] for an empty input without running anything', async () => {
    let calls = 0
    const out = await mapWithConcurrency([], 4, async () => { calls++; return 1 })
    expect(out).toEqual([])
    expect(calls).toBe(0)
  })

  it('propagates a rejection (Promise.all semantics)', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      })
    ).rejects.toThrow('boom')
  })
})

describe('mapSettledWithConcurrency', () => {
  it('isolates rejections and keeps order', async () => {
    const out = await mapSettledWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom')
      return n
    })
    expect(out.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
    expect(out[0]).toMatchObject({ value: 1 })
    expect(out[2]).toMatchObject({ value: 3 })
  })

  it('never exceeds the concurrency limit even when items reject', async () => {
    const t = makeTracker()
    const items = Array.from({ length: 30 }, (_, i) => i)
    await mapSettledWithConcurrency(items, 3, t.wrap(async (n: number) => {
      if (n % 4 === 0) throw new Error('nope')
      return n
    }))
    expect(t.peak).toBeLessThanOrEqual(3)
    expect(t.peak).toBeGreaterThan(1)
  })
})
