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
      // Upsert into assets_metadata first
      await supabase.from('assets_metadata').upsert(
        { ticker, name, type },
        { onConflict: 'ticker', ignoreDuplicates: true }
      )
      await addAsset(ticker)
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
