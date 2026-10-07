'use client'

import { useState, useCallback } from 'react'
import { useWatchlistAssets } from '@/hooks/useWatchlistAssets'
import { WatchlistTable } from '@/components/dashboard/WatchlistTable'
import type { AssetMetadata, MetricKey, Watchlist, AssetType } from '@/types'

interface WatchlistViewProps {
  watchlist: Watchlist
  allAssets: AssetMetadata[]
}

export function WatchlistView({ watchlist: initialWatchlist, allAssets }: WatchlistViewProps) {
  const [watchlist, setWatchlist] = useState<Watchlist>(initialWatchlist)
  const { assets, addAsset, removeAsset } = useWatchlistAssets(watchlist.id)

  const handleAddAsset = useCallback(
    async (ticker: string, name: string, type: AssetType) => {
      // Registrar en assets_metadata primero (vía servidor: el navegador ya no puede insertar ahí)
      await fetch('/api/assets/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, name, type }),
      }).catch(() => undefined)
      await addAsset(ticker)
    },
    [addAsset]
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
