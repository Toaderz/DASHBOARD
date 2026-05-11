'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { ArrowUpDown, ArrowUp, ArrowDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PriceCell } from './PriceCell'
import { MetricsSelector } from './MetricsSelector'
import { TickerSearch } from './TickerSearch'
import { AssetDetailModal } from './AssetDetailModal'
import { useRealtimePrices } from '@/hooks/useRealtimePrices'
import { usePerformanceMetrics } from '@/hooks/usePerformanceMetrics'
import { createClient } from '@/lib/supabase/client'
import { formatPercent, formatMarketCap, formatRatio, formatExpenseRatio, percentColor, annualizeReturn } from '@/lib/utils/formatters'
import { METRIC_DEFINITIONS } from '@/types'
import type { AssetMetadata, AssetWithCategory, MetricKey, Watchlist, AssetType } from '@/types'
import { computeInitialPeers } from '@/lib/market/peer-taxonomy'

interface WatchlistTableProps {
  watchlist: Watchlist
  assets: AssetWithCategory[]
  onRemoveAsset: (ticker: string) => Promise<void>
  onAddAsset: (ticker: string, name: string, type: AssetType) => Promise<void>
  onMetricsChange: (metrics: MetricKey[]) => void
  allAssets: AssetMetadata[]
}

const helper = createColumnHelper<AssetWithCategory>()

export function WatchlistTable({
  watchlist,
  assets,
  onRemoveAsset,
  onAddAsset,
  onMetricsChange,
  allAssets,
}: WatchlistTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [selectedAsset, setSelectedAsset] = useState<AssetMetadata | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [annualize, setAnnualize] = useState(false)

  // Years for annualizable periods (>1Y with fixed duration)
  const ANNUALIZE_YEARS: Partial<Record<string, number>> = { '3Y': 3, '5Y': 5, '10Y': 10 }

  const tickers = useMemo(() => assets.map((a) => a.ticker), [assets])
  const { prices, flashStates } = useRealtimePrices(tickers)
  const activeMetrics = watchlist.selected_metrics as MetricKey[]
  const { returns, maxYears } = usePerformanceMetrics(tickers, prices, activeMetrics)

  const supabase = createClient()

  // Build column visibility from watchlist.selected_metrics
  const columnVisibility = useMemo<VisibilityState>(() => {
    const vis: VisibilityState = {}
    METRIC_DEFINITIONS.forEach((def) => {
      vis[def.key] = activeMetrics.includes(def.key)
    })
    return vis
  }, [activeMetrics])

  const handleMetricsChange = useCallback(
    async (next: MetricKey[]) => {
      onMetricsChange(next)
      await supabase
        .from('watchlists')
        .update({ selected_metrics: next })
        .eq('id', watchlist.id)
    },
    [supabase, watchlist.id, onMetricsChange]
  )

  const handleRowClick = useCallback(
    (asset: AssetMetadata) => {
      setSelectedAsset(asset)
      setModalOpen(true)
    },
    []
  )

  const columns = useMemo(
    () => [
      helper.accessor('ticker', {
        header: 'Ticker',
        cell: ({ row }) => (
          <span className="font-mono font-semibold">{row.original.ticker}</span>
        ),
      }),
      helper.accessor('name', {
        header: 'Name',
        cell: ({ getValue }) => (
          <span className="truncate text-muted-foreground">{getValue()}</span>
        ),
      }),
      helper.display({
        id: 'price',
        header: 'Price',
        cell: ({ row }) => {
          const t = row.original.ticker
          return <PriceCell price={prices[t]?.price} flashState={flashStates[t] ?? null} />
        },
      }),
      helper.display({
        id: '1D',
        header: '1D %',
        cell: ({ row }) => {
          const t = row.original.ticker
          const v = prices[t]?.change_percent
          return <span className={percentColor(v)}>{formatPercent(v)}</span>
        },
      }),
      ...(['1W', '1M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'] as MetricKey[]).map((period) =>
        helper.display({
          id: period,
          header: () => {
            const isAnnualizable = !!ANNUALIZE_YEARS[period] || period === 'MAX'
            return <span>{period} %{annualize && isAnnualizable ? <span className="text-[10px] text-muted-foreground ml-0.5">ann</span> : null}</span>
          },
          cell: ({ row }) => {
            const t = row.original.ticker
            const raw = returns[t]?.[period]
            const years = ANNUALIZE_YEARS[period] ?? (period === 'MAX' ? (maxYears[t] ?? null) : null)
            const canAnnualize = years != null && years >= 1
            const v = annualize && canAnnualize ? annualizeReturn(raw, years!) : raw
            return <span className={percentColor(v)}>{formatPercent(v)}</span>
          },
        })
      ),
      helper.display({
        id: 'marketCap',
        header: 'Mkt Cap',
        cell: ({ row }) => {
          const t = row.original.ticker
          const mc = prices[t]?.market_cap ?? prices[t]?.aum
          return <span className="tabular-nums">{formatMarketCap(mc ?? undefined)}</span>
        },
      }),
      helper.display({
        id: 'pe',
        header: 'P/E',
        cell: ({ row }) => {
          const t = row.original.ticker
          const pe = prices[t]?.pe
          return (
            <span className="tabular-nums">
              {pe != null ? formatRatio(pe) : <span className="text-muted-foreground">—</span>}
            </span>
          )
        },
      }),
      helper.display({
        id: 'dividendYield',
        header: 'Div Yield',
        cell: ({ row }) => {
          const t = row.original.ticker
          const dy = prices[t]?.dividend_yield
          return (
            <span className="tabular-nums">
              {dy != null && dy > 0
                ? formatPercent(dy)
                : <span className="text-muted-foreground">—</span>}
            </span>
          )
        },
      }),
      helper.display({
        id: 'from52wHigh',
        header: '52W High',
        cell: ({ row }) => {
          const t = row.original.ticker
          const price = prices[t]?.price
          const high = prices[t]?.high_52w
          if (!price || !high) return <span className="text-muted-foreground">—</span>
          const pct = ((price - high) / high) * 100
          return <span className={percentColor(pct)}>{formatRatio(pct)}%</span>
        },
      }),
      helper.display({
        id: 'expenseRatio',
        header: 'Exp. Ratio',
        cell: ({ row }) => {
          const t = row.original.ticker
          const er = prices[t]?.expense_ratio
          return (
            <span className="tabular-nums">
              {er != null ? formatExpenseRatio(er) : <span className="text-muted-foreground">—</span>}
            </span>
          )
        },
      }),
      helper.display({
        id: 'aum',
        header: 'AUM',
        cell: ({ row }) => {
          const t = row.original.ticker
          const a = prices[t]?.aum
          return <span className="tabular-nums">{formatMarketCap(a ?? undefined)}</span>
        },
      }),
      helper.display({
        id: 'beta',
        header: 'Beta',
        cell: ({ row }) => {
          const t = row.original.ticker
          const b = prices[t]?.beta
          return (
            <span className="tabular-nums">
              {b != null ? formatRatio(b) : <span className="text-muted-foreground">—</span>}
            </span>
          )
        },
      }),
      helper.display({
        id: 'profitMargins',
        header: 'Net Margin',
        cell: ({ row }) => {
          const t = row.original.ticker
          const pm = prices[t]?.profit_margins
          return (
            <span className="tabular-nums">
              {pm != null ? formatPercent(pm) : <span className="text-muted-foreground">—</span>}
            </span>
          )
        },
      }),
      helper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              onRemoveAsset(row.original.ticker)
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        ),
      }),
    ],
    [prices, flashStates, returns, maxYears, onRemoveAsset, annualize]
  )

  const table = useReactTable({
    data: assets,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const initialPeers = useMemo(
    () => (selectedAsset ? computeInitialPeers(selectedAsset, allAssets) : []),
    [selectedAsset, allAssets]
  )

  // Show category separators only when the table is in default (unsorted) order
  const showCategories = sorting.length === 0
  const visibleColCount = table.getVisibleLeafColumns().length

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-48 max-w-80">
          <TickerSearch onAdd={onAddAsset} existingTickers={tickers} />
        </div>
        <button
          onClick={() => setAnnualize((v) => !v)}
          title="Annualize returns for 3Y, 5Y, 10Y periods"
          className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
            annualize
              ? 'bg-foreground text-background border-foreground'
              : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'
          }`}
        >
          Ann.
        </button>
        <MetricsSelector selected={activeMetrics} onChange={handleMetricsChange} />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b bg-muted/30">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                  >
                    {header.isPlaceholder ? null : (
                      <button
                        className="flex items-center gap-1"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <>
                            {header.column.getIsSorted() === 'asc' && (
                              <ArrowUp className="h-3 w-3" />
                            )}
                            {header.column.getIsSorted() === 'desc' && (
                              <ArrowDown className="h-3 w-3" />
                            )}
                            {!header.column.getIsSorted() && (
                              <ArrowUpDown className="h-3 w-3 opacity-40" />
                            )}
                          </>
                        )}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {assets.length === 0 ? (
              <tr>
                <td
                  colSpan={table.getAllColumns().length}
                  className="py-12 text-center text-muted-foreground"
                >
                  No assets yet. Use the search above to add tickers.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.flatMap((row, i, rows) => {
                const cat = row.original.category
                const prevCat = i > 0 ? rows[i - 1].original.category : undefined
                const showHeader = showCategories && cat != null && cat !== prevCat
                const elements = []

                if (showHeader) {
                  elements.push(
                    <tr key={`cat-${cat}`} className="bg-muted/20 border-b border-border/50">
                      <td
                        colSpan={visibleColCount}
                        className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
                      >
                        {cat}
                      </td>
                    </tr>
                  )
                }

                elements.push(
                  <tr
                    key={row.id}
                    className="group border-b cursor-pointer transition-colors hover:bg-accent/50 last:border-0"
                    onClick={() => handleRowClick(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                )

                return elements
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Loading skeletons */}
      {tickers.length > 0 && Object.keys(prices).length === 0 && (
        <div className="space-y-2">
          {tickers.map((t) => (
            <Skeleton key={t} className="h-10 w-full" />
          ))}
        </div>
      )}

      {/* Detail Modal */}
      <AssetDetailModal
        asset={selectedAsset}
        quote={selectedAsset ? (prices[selectedAsset.ticker] ?? null) : null}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialPeers={initialPeers}
      />
    </div>
  )
}
