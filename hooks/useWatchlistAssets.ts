'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AssetMetadata, Watchlist } from '@/types'

export function useWatchlists() {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchWatchlists = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('watchlists')
      .select('*')
      .order('created_at', { ascending: true })
    setWatchlists((data as Watchlist[]) ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchWatchlists()
  }, [fetchWatchlists])

  const createWatchlist = async (name: string, description?: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { data: null, error: new Error('Not authenticated') }

    const { data, error } = await supabase
      .from('watchlists')
      .insert({ name, description: description ?? null, user_id: user.id })
      .select()
      .single()
    if (!error && data) {
      setWatchlists((prev) => [...prev, data as Watchlist])
    }
    return { data, error }
  }

  const updateWatchlist = async (id: string, updates: Partial<Watchlist>) => {
    const { data, error } = await supabase
      .from('watchlists')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (!error && data) {
      setWatchlists((prev) => prev.map((w) => (w.id === id ? (data as Watchlist) : w)))
    }
    return { data, error }
  }

  const deleteWatchlist = async (id: string) => {
    const { error } = await supabase.from('watchlists').delete().eq('id', id)
    if (!error) {
      setWatchlists((prev) => prev.filter((w) => w.id !== id))
    }
    return { error }
  }

  return { watchlists, loading, refetch: fetchWatchlists, createWatchlist, updateWatchlist, deleteWatchlist }
}

export function useWatchlistAssets(watchlistId: string) {
  const [assets, setAssets] = useState<AssetMetadata[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchAssets = useCallback(async () => {
    if (!watchlistId) return
    setLoading(true)
    const { data } = await supabase
      .from('watchlist_assets')
      .select('asset_ticker, assets_metadata(*)')
      .eq('watchlist_id', watchlistId)

    const mapped = (data ?? []).map((row: { asset_ticker: string; assets_metadata: AssetMetadata | AssetMetadata[] | null }) => {
      const meta = Array.isArray(row.assets_metadata) ? row.assets_metadata[0] : row.assets_metadata
      return meta ?? { ticker: row.asset_ticker, name: row.asset_ticker, type: 'stock' as const, sector: null, region: null, industry: null, benchmark: null, manager: null }
    })

    setAssets(mapped)
    setLoading(false)
  }, [supabase, watchlistId])

  useEffect(() => {
    fetchAssets()
  }, [fetchAssets])

  const addAsset = async (ticker: string) => {
    const { error } = await supabase
      .from('watchlist_assets')
      .insert({ watchlist_id: watchlistId, asset_ticker: ticker })
      .select()

    if (!error) await fetchAssets()
    return { error }
  }

  const removeAsset = async (ticker: string) => {
    const { error } = await supabase
      .from('watchlist_assets')
      .delete()
      .eq('watchlist_id', watchlistId)
      .eq('asset_ticker', ticker)

    if (!error) setAssets((prev) => prev.filter((a) => a.ticker !== ticker))
    return { error }
  }

  return { assets, loading, refetch: fetchAssets, addAsset, removeAsset }
}
