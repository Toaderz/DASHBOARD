'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AssetMetadata, AssetType } from '@/types'

const PEER_CATEGORY = (base: string) => `Peers · ${base}`

function uniqUpper(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of list) {
    const u = t.toUpperCase()
    if (!seen.has(u)) { seen.add(u); out.push(u) }
  }
  return out
}

// Efectivo = (auto − removed) ∪ pinned, sin el propio activo.
function effective(self: string, auto: string[], pinned: string[], removed: string[]): string[] {
  const rm = new Set(removed.map((t) => t.toUpperCase()))
  const base = auto.map((t) => t.toUpperCase()).filter((t) => !rm.has(t))
  return uniqUpper([...base, ...pinned.map((t) => t.toUpperCase())]).filter((t) => t !== self.toUpperCase())
}

/**
 * Loads and mutates the per-user curated peer set for a single asset.
 *
 * Source of truth is `user_asset_peers`. Modelo no destructivo y determinista:
 *   peers (efectivo) = (auto_peers − removed) ∪ pinned
 * addPeer → pinned; removePeer → removed. El motor nunca re-agrega un `removed` ni pierde un `pinned`.
 * Además sincroniza las filas `source='auto-peer'` de la watchlist (visibilidad/curación), sin tocar
 * holdings del usuario. El set inicial se materializa server-side vía /api/peers/init.
 */
export function usePeerSet(assetTicker: string | null, seed: AssetMetadata[]) {
  const [peers, setPeers] = useState<AssetMetadata[]>([])
  const [loading, setLoading] = useState(false)

  const seedRef = useRef<AssetMetadata[]>(seed)
  seedRef.current = seed
  // Estado de curación (strings, MAYÚSCULAS) para recomputar el efectivo sin perder invariantes.
  const autoRef = useRef<string[]>([])
  const pinnedRef = useRef<string[]>([])
  const removedRef = useRef<string[]>([])
  // Cache de name/type para hidratar peers agregados manualmente.
  const metaCacheRef = useRef<Map<string, { name: string; type: AssetType }>>(new Map())

  const hydrate = useCallback((tickers: string[]): AssetMetadata[] => {
    const seedMap = new Map(seedRef.current.map((p) => [p.ticker.toUpperCase(), p]))
    return tickers.map((t) => {
      const u = t.toUpperCase()
      const hit = seedMap.get(u)
      if (hit) return hit
      const cached = metaCacheRef.current.get(u)
      return { ticker: t, name: cached?.name ?? t, type: (cached?.type ?? 'etf') as AssetType, sector: null, region: null, industry: null, benchmark: null, manager: null }
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
        .select('peers, initialized, auto_peers, pinned, removed')
        .eq('asset_ticker', ticker)
        .maybeSingle()

      if (cancelled) return

      if (data?.initialized) {
        autoRef.current = (data.auto_peers as string[]) ?? []
        pinnedRef.current = (data.pinned as string[]) ?? []
        removedRef.current = (data.removed as string[]) ?? []
        setPeers(hydrate((data.peers as string[]) ?? effective(ticker, autoRef.current, pinnedRef.current, removedRef.current)))
        setLoading(false)
        return
      }

      // Not initialized yet — materialize canonically server-side, then re-read provenance.
      try {
        const res = await fetch('/api/peers/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers: [ticker] }),
        })
        const json = (await res.json()) as Record<string, string[]>
        if (cancelled) return
        const eff = json[ticker] ?? []
        // Re-leer la fila para conocer auto/pinned/removed (init los persistió).
        const { data: row } = await supabase
          .from('user_asset_peers')
          .select('auto_peers, pinned, removed')
          .eq('asset_ticker', ticker)
          .maybeSingle()
        autoRef.current = (row?.auto_peers as string[]) ?? eff
        pinnedRef.current = (row?.pinned as string[]) ?? []
        removedRef.current = (row?.removed as string[]) ?? []
        if (!cancelled) setPeers(hydrate(eff))
      } catch {
        if (!cancelled) setPeers([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [assetTicker, hydrate])

  // Persiste el set de curación. Omite auto_peers/engine_version → se preservan en el UPDATE.
  const persist = useCallback(async (eff: string[]) => {
    if (!assetTicker) return
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('user_asset_peers').upsert(
      {
        user_id: user.id,
        asset_ticker: assetTicker.toUpperCase(),
        peers: eff,
        pinned: pinnedRef.current,
        removed: removedRef.current,
        initialized: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,asset_ticker' }
    )
  }, [assetTicker])

  // Inserta el peer como fila 'auto-peer' en las watchlists propias que contienen el base.
  const syncWatchlistAdd = useCallback(async (peer: string, name: string, type: AssetType) => {
    if (!assetTicker) return
    const base = assetTicker.toUpperCase()
    const supabase = createClient()
    const { data: locs } = await supabase
      .from('watchlist_assets')
      .select('watchlist_id, sort_order')
      .eq('asset_ticker', base)
      .eq('source', 'user')
    if (!locs?.length) return
    await supabase.from('assets_metadata').upsert(
      { ticker: peer, name: name || peer, type },
      { onConflict: 'ticker', ignoreDuplicates: true }
    )
    const rows = locs.map((l: { watchlist_id: string; sort_order: number | null }) => ({
      watchlist_id: l.watchlist_id,
      asset_ticker: peer,
      category: PEER_CATEGORY(base),
      source: 'auto-peer',
      peer_of: base,
      sort_order: (l.sort_order ?? 0) * 100 + 99,
    }))
    await supabase.from('watchlist_assets').upsert(rows, { onConflict: 'watchlist_id,asset_ticker,category', ignoreDuplicates: true })
  }, [assetTicker])

  // Borra las filas 'auto-peer' (base, peer) de las watchlists propias.
  const syncWatchlistRemove = useCallback(async (peer: string) => {
    if (!assetTicker) return
    const base = assetTicker.toUpperCase()
    const supabase = createClient()
    await supabase
      .from('watchlist_assets')
      .delete()
      .eq('peer_of', base)
      .eq('asset_ticker', peer)
      .eq('source', 'auto-peer')
  }, [assetTicker])

  const addPeer = useCallback((ticker: string, name: string, type: AssetType) => {
    const u = ticker.toUpperCase()
    metaCacheRef.current.set(u, { name, type })
    pinnedRef.current = uniqUpper([...pinnedRef.current, u])
    removedRef.current = removedRef.current.filter((t) => t.toUpperCase() !== u)
    const eff = effective(assetTicker ?? '', autoRef.current, pinnedRef.current, removedRef.current)
    setPeers(hydrate(eff))
    persist(eff)
    syncWatchlistAdd(u, name, type)
  }, [assetTicker, hydrate, persist, syncWatchlistAdd])

  const removePeer = useCallback((ticker: string) => {
    const u = ticker.toUpperCase()
    removedRef.current = uniqUpper([...removedRef.current, u])
    pinnedRef.current = pinnedRef.current.filter((t) => t.toUpperCase() !== u)
    const eff = effective(assetTicker ?? '', autoRef.current, pinnedRef.current, removedRef.current)
    setPeers(hydrate(eff))
    persist(eff)
    syncWatchlistRemove(u)
  }, [assetTicker, hydrate, persist, syncWatchlistRemove])

  return { peers, addPeer, removePeer, loading }
}
