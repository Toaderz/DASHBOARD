'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AssetMetadata, AssetType } from '@/types'

/**
 * Loads and mutates the per-user curated peer set for a single asset.
 *
 * Source of truth is the `user_asset_peers` table. When the row is missing, the
 * canonical server-side initializer (/api/peers/init) materializes it
 * deterministically. add/remove persist immediately (optimistic UI).
 *
 * `seed` (e.g. client-computed initialPeers) is only used to hydrate names/types
 * for display — never as the persisted set.
 */
export function usePeerSet(assetTicker: string | null, seed: AssetMetadata[]) {
  const [peers, setPeers] = useState<AssetMetadata[]>([])
  const [loading, setLoading] = useState(false)
  // Keep the latest seed without retriggering the loader on every render.
  const seedRef = useRef<AssetMetadata[]>(seed)
  seedRef.current = seed

  const hydrate = useCallback((tickers: string[]): AssetMetadata[] => {
    const seedMap = new Map(seedRef.current.map((p) => [p.ticker.toUpperCase(), p]))
    return tickers.map((t) => {
      const hit = seedMap.get(t.toUpperCase())
      if (hit) return hit
      return { ticker: t, name: t, type: 'etf' as AssetType, sector: null, region: null, industry: null, benchmark: null, manager: null }
    })
  }, [])

  useEffect(() => {
    if (!assetTicker) { setPeers([]); return }
    const ticker = assetTicker.toUpperCase()
    let cancelled = false
    setLoading(true)

    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('user_asset_peers')
        .select('peers, initialized')
        .eq('asset_ticker', ticker)
        .maybeSingle()

      if (cancelled) return

      if (data?.initialized) {
        setPeers(hydrate((data.peers as string[]) ?? []))
        setLoading(false)
        return
      }

      // Not initialized yet — materialize canonically server-side.
      try {
        const res = await fetch('/api/peers/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers: [ticker] }),
        })
        const json = (await res.json()) as Record<string, string[]>
        if (!cancelled) setPeers(hydrate(json[ticker] ?? []))
      } catch {
        if (!cancelled) setPeers([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [assetTicker, hydrate])

  const persist = useCallback(async (tickers: string[]) => {
    if (!assetTicker) return
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('user_asset_peers').upsert(
      { user_id: user.id, asset_ticker: assetTicker.toUpperCase(), peers: tickers, initialized: true, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,asset_ticker' }
    )
  }, [assetTicker])

  const addPeer = useCallback((ticker: string, name: string, type: AssetType) => {
    setPeers((prev) => {
      if (prev.some((p) => p.ticker.toUpperCase() === ticker.toUpperCase())) return prev
      const next = [...prev, { ticker, name, type, sector: null, region: null, industry: null, benchmark: null, manager: null }]
      persist(next.map((p) => p.ticker))
      return next
    })
  }, [persist])

  const removePeer = useCallback((ticker: string) => {
    setPeers((prev) => {
      const next = prev.filter((p) => p.ticker.toUpperCase() !== ticker.toUpperCase())
      persist(next.map((p) => p.ticker))
      return next
    })
  }, [persist])

  return { peers, addPeer, removePeer, loading }
}
