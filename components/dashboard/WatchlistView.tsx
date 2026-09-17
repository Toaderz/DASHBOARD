'use client'

import { useState, useCallback } from 'react'
import { useWatchlistAssets } from '@/hooks/useWatchlistAssets'
import { WatchlistTable } from '@/components/dashboard/WatchlistTable'
import { createClient } from '@/lib/supabase/client'
import type { AssetMetadata, MetricKey, Watchlist, AssetType } from '@/types'

interface WatchlistViewProps {
  watchlist: Watchlist
  allAssets: AssetMetadata[]
}

export function WatchlistView({ watchlist: initialWatchlist, allAssets }: WatchlistViewProps) {
  const [watchlist, setWatchlist] = useState<Watchlist>(initialWatchlist)
  const { assets, addAsset, removeAsset } = useWatchlistAssets(watchlist.id)
  const supabase = createClient()

  const handleAddAsset = useCallback(
    async (ticker: string, name: string, type: AssetType) => {
      // Normalización de ticker — cinturón y tirantes con el trigger
      // `assets_metadata_normalize_ticker` de 005_restrict_assets_metadata.sql.
      // El WITH CHECK de RLS exige el ticker en MAYÚSCULAS sin espacios. Sin
      // esto, un ticker en minúsculas (a) fallaría el check, (b) el error se
      // descarta aquí abajo y (c) `addAsset` acabaría en FK 23503 → "añadir
      // activo" roto en silencio. Además garantiza que el ticker que se inserta
      // en watchlist_assets sea EL MISMO que el trigger dejó en assets_metadata.
      const normalizedTicker = ticker.trim().toUpperCase()

      // Upsert into assets_metadata first
      await supabase.from('assets_metadata').upsert(
        { ticker: normalizedTicker, name, type },
        { onConflict: 'ticker', ignoreDuplicates: true }
      )
      await addAsset(normalizedTicker)
    },
    [addAsset, supabase]
  )

  const handleRemoveAsset = useCallback(
    async (ticker: string) => {
      await removeAsset(ticker)
    },
    [removeAsset]
  )

  const handleMetricsChange = useCallback((metrics: MetricKey[]) => {
    setWatchlist((prev) => ({ ...prev, selected_metrics: metrics }))
  }, [])

  return (
    <WatchlistTable
      watchlist={watchlist}
      assets={assets}
      onAddAsset={handleAddAsset}
      onRemoveAsset={handleRemoveAsset}
      onMetricsChange={handleMetricsChange}
      allAssets={allAssets}
    />
  )
}
