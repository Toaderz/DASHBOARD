'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AssetMetadata, AssetWithCategory, Watchlist, WatchlistShare } from '@/types'

export function useWatchlists() {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchWatchlists = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('watchlists')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) console.error('[useWatchlists] fetch error:', error)
    setWatchlists((data as Watchlist[]) ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchWatchlists()
  }, [fetchWatchlists])

  const createWatchlist = async (name: string, description?: string) => {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) console.error('[createWatchlist] auth error:', authError)
    if (!user) return { data: null, error: new Error('Not authenticated — sesión no válida') }

    const { data, error } = await supabase
      .from('watchlists')
      .insert({ name, description: description ?? null, user_id: user.id })
      .select()
      .single()
    if (error) console.error('[createWatchlist] insert error:', error)
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
  const [assets, setAssets] = useState<AssetWithCategory[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchAssets = useCallback(async () => {
    if (!watchlistId) return
    setLoading(true)
    const { data } = await supabase
      .from('watchlist_assets')
      .select('asset_ticker, category, sort_order, assets_metadata(*)')
      .eq('watchlist_id', watchlistId)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('added_at', { ascending: true })

    const mapped = (data ?? []).map((row: { asset_ticker: string; category: string | null; sort_order: number | null; assets_metadata: AssetMetadata | AssetMetadata[] | null }) => {
      const meta = Array.isArray(row.assets_metadata) ? row.assets_metadata[0] : row.assets_metadata
      return {
        ...(meta ?? { ticker: row.asset_ticker, name: row.asset_ticker, type: 'stock' as const, sector: null, region: null, industry: null, benchmark: null, manager: null }),
        category: row.category ?? null,
      }
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

export function useWatchlistShares(watchlistId: string | null) {
  const [shares, setShares] = useState<WatchlistShare[]>([])
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  const fetchShares = useCallback(async () => {
    if (!watchlistId) { setShares([]); return }
    setLoading(true)
    const { data } = await supabase
      .from('watchlist_shares')
      .select('id, watchlist_id, shared_with_user_id, created_at, profiles(email)')
      .eq('watchlist_id', watchlistId)
    setShares((data as WatchlistShare[]) ?? [])
    setLoading(false)
  }, [supabase, watchlistId])

  useEffect(() => { fetchShares() }, [fetchShares])

  const addShare = async (email: string): Promise<{ error: string | null }> => {
    const res = await fetch(`/api/users/find?email=${encodeURIComponent(email)}`)
    const body = await res.json()
    if (!res.ok) return { error: body.error ?? 'Error al compartir' }

    const { error } = await supabase
      .from('watchlist_shares')
      .insert({ watchlist_id: watchlistId, shared_with_user_id: body.id })
    if (error) return { error: error.message }
    await fetchShares()
    return { error: null }
  }

  const removeShare = async (shareId: string): Promise<{ error: string | null }> => {
    const { error } = await supabase
      .from('watchlist_shares')
      .delete()
      .eq('id', shareId)
    if (!error) setShares((prev) => prev.filter((s) => s.id !== shareId))
    return { error: error ? error.message : null }
  }

  const addTeamShares = async (): Promise<{ error: string | null; count: number }> => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: teamMembers, error: fetchError } = await supabase
      .from('profiles')
      .select('id')
      .eq('is_team_evolve', true)
      .neq('id', user?.id ?? '')
    if (fetchError) return { error: fetchError.message, count: 0 }
    if (!teamMembers?.length) return { error: null, count: 0 }

    const existingIds = new Set(shares.map((s) => s.shared_with_user_id))
    const toAdd = teamMembers.filter((m) => !existingIds.has(m.id))
    if (!toAdd.length) return { error: null, count: 0 }

    const { error } = await supabase
      .from('watchlist_shares')
      .insert(toAdd.map((m) => ({ watchlist_id: watchlistId, shared_with_user_id: m.id })))
    if (error) return { error: error.message, count: 0 }
    await fetchShares()
    return { error: null, count: toAdd.length }
  }

  return { shares, loading, addShare, removeShare, addTeamShares, refetch: fetchShares }
}
