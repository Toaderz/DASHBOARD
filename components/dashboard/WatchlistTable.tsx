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
import { ArrowUpDown, ArrowUp, ArrowDown, X, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PriceCell } from './PriceCell'
import { MetricsSelector } from './MetricsSelector'
import { TickerSearch } from './TickerSearch'
import { AssetDetailModal } from './AssetDetailModal'
import { useRealtimePrices } from '@/hooks/useRealtimePrices'
import { usePerformanceMetrics } from '@/hooks/usePerformanceMetrics'
import { createClient } from '@/lib/supabase/client'
import { formatPercent, formatMarketCap, formatRatio, formatExpenseRatio, percentColor, annualizeReturn, getCurrencySymbol } from '@/lib/utils/formatters'
import { useFxData } from '@/hooks/useFxData'
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
  const [usd, setUsd] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')

  // Years for annualizable periods (>1Y with fixed duration)
  const ANNUALIZE_YEARS: Partial<Record<string, number>> = { '3Y': 3, '5Y': 5, '10Y': 10 }

  const tickers = useMemo(() => assets.map((a) => a.ticker), [assets])
  const { prices, flashStates } = useRealtimePrices(tickers)
  const activeMetrics = watchlist.selected_metrics as MetricKey[]
  const { returns, maxYears } = usePerformanceMetrics(tickers, prices, activeMetrics)

  const RETURN_PERIODS_SET = new Set(['1W', '1M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'])
  const activePeriods = useMemo(
    () => activeMetrics.filter((m): m is MetricKey => RETURN_PERIODS_SET.has(m)),
    [activeMetrics]
  )
  const uniqueCurrencies = useMemo(
    () => [...new Set(tickers.map((t) => prices[t]?.currency).filter((c): c is string => !!c))],
    [tickers, prices]
  )
  const { fxRates, fxPeriodReturns } = useFxData(uniqueCurrencies, activePeriods)

  const toUsd = useCallback(
    (value: number | null | undefined, ticker: string): number | null => {
      if (value == null || !usd) return value ?? null
      const c = prices[ticker]?.currency
      if (!c || c === 'USD') return value
      const rate = fxRates[c]?.rate
      return rate != null ? value * rate : value
    },
    [usd, prices, fxRates]
  )

  const adjReturn = useCallback(
    (raw: number | null | undefined, ticker: string, period: MetricKey): number | null => {
      if (raw == null) return null
      if (!usd) return raw
      const c = prices[ticker]?.currency
      if (!c || c === 'USD') return raw
      const fx = fxPeriodReturns[c]?.[period]
      if (fx == null) return raw
      return ((1 + raw / 100) * (1 + fx / 100) - 1) * 100
    },
    [usd, prices, fxPeriodReturns]
  )

  const adj1d = useCallback(
    (raw: number | null | undefined, ticker: string): number | null => {
      if (raw == null) return null
      if (!usd) return raw
      const c = prices[ticker]?.currency
      if (!c || c === 'USD') return raw
      const fxChange = fxRates[c]?.change1d
      if (fxChange == null) return raw
      return ((1 + raw / 100) * (1 + fxChange / 100) - 1) * 100
    },
    [usd, prices, fxRates]
  )

  const mcSymbol = useCallback(
    (ticker: string) => usd ? '$' : getCurrencySymbol(prices[ticker]?.currency),
    [usd, prices]
  )

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
    () => {
      // Nulls always sort to the end regardless of asc/desc direction
      const numSort = (a: number | null | undefined, b: number | null | undefined) => {
        if (a == null && b == null) return 0
        if (a == null) return 1
        if (b == null) return -1
        return a - b
      }

      return [
        helper.accessor('ticker', {
          header: 'Ticker',
          cell: ({ row }) => (
            <span className="font-mono text-xs font-bold tracking-wider text-electric">{row.original.ticker}</span>
          ),
        }),
        helper.accessor('name', {
          header: 'Name',
          cell: ({ getValue }) => (
            <span className="truncate font-ui text-xs text-muted-foreground max-w-[140px] block">{getValue()}</span>
          ),
        }),
        helper.accessor((row) => prices[row.ticker]?.price ?? null, {
          id: 'price',
          header: 'Price',
          sortingFn: (rowA, rowB) => {
            const a = toUsd(prices[rowA.original.ticker]?.price, rowA.original.ticker) ?? prices[rowA.original.ticker]?.price ?? null
            const b = toUsd(prices[rowB.original.ticker]?.price, rowB.original.ticker) ?? prices[rowB.original.ticker]?.price ?? null
            return numSort(a, b)
          },
          cell: ({ row }) => {
            const t = row.original.ticker
            const q = prices[t]
            const displayCurrency = usd ? 'USD' : (q?.currency ?? 'USD')
            const displayPrice = usd ? toUsd(q?.price, t) ?? q?.price : q?.price
            return <PriceCell price={displayPrice} flashState={flashStates[t] ?? null} currency={displayCurrency} />
          },
        }),
        helper.display({
          id: 'currency',
          header: 'CCY',
          enableSorting: false,
          cell: ({ row }) => {
            const c = prices[row.original.ticker]?.currency
            return c
              ? <span className="text-[10px] font-mono text-muted-foreground">{c}</span>
              : <span className="text-muted-foreground">—</span>
          },
        }),
        helper.accessor((row) => prices[row.ticker]?.change_percent ?? null, {
          id: '1D',
          header: '1D %',
          sortingFn: (rowA, rowB) =>
            numSort(adj1d(prices[rowA.original.ticker]?.change_percent, rowA.original.ticker),
                    adj1d(prices[rowB.original.ticker]?.change_percent, rowB.original.ticker)),
          cell: ({ row }) => {
            const t = row.original.ticker
            const v = adj1d(prices[t]?.change_percent, t)
            return <span className={percentColor(v)}>{formatPercent(v)}</span>
          },
        }),
        ...(['1W', '1M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'] as MetricKey[]).map((period) =>
          helper.accessor((row) => returns[row.ticker]?.[period] ?? null, {
            id: period,
            header: () => {
              const isAnnualizable = !!ANNUALIZE_YEARS[period] || period === 'MAX'
              return <span>{period} %{annualize && isAnnualizable ? <span className="text-[10px] text-muted-foreground ml-0.5">ann</span> : null}</span>
            },
            sortingFn: (rowA, rowB) => {
              const getVal = (ticker: string) => {
                const raw = adjReturn(returns[ticker]?.[period], ticker, period)
                const years = ANNUALIZE_YEARS[period] ?? (period === 'MAX' ? (maxYears[ticker] ?? null) : null)
                const canAnnualize = years != null && years >= 1
                return annualize && canAnnualize ? annualizeReturn(raw, years!) : raw
              }
              return numSort(getVal(rowA.original.ticker), getVal(rowB.original.ticker))
            },
            cell: ({ row }) => {
              const t = row.original.ticker
              const raw = adjReturn(returns[t]?.[period], t, period)
              const years = ANNUALIZE_YEARS[period] ?? (period === 'MAX' ? (maxYears[t] ?? null) : null)
              const canAnnualize = years != null && years >= 1
              const v = annualize && canAnnualize ? annualizeReturn(raw, years!) : raw
              return <span className={percentColor(v)}>{formatPercent(v)}</span>
            },
          })
        ),
        helper.accessor((row) => prices[row.ticker]?.market_cap ?? null, {
          id: 'marketCap',
          header: 'Mkt Cap',
          sortingFn: (rowA, rowB) =>
            numSort(toUsd(prices[rowA.original.ticker]?.market_cap, rowA.original.ticker),
                    toUsd(prices[rowB.original.ticker]?.market_cap, rowB.original.ticker)),
          cell: ({ row }) => {
            const t = row.original.ticker
            const mc = toUsd(prices[t]?.market_cap, t)
            return <span className="tabular-nums">{formatMarketCap(mc ?? undefined, mcSymbol(t))}</span>
          },
        }),
        helper.accessor((row) => prices[row.ticker]?.pe ?? null, {
          id: 'pe',
          header: 'P/E',
          sortingFn: (rowA, rowB) =>
            numSort(prices[rowA.original.ticker]?.pe, prices[rowB.original.ticker]?.pe),
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
        helper.accessor((row) => prices[row.ticker]?.dividend_yield ?? null, {
          id: 'dividendYield',
          header: 'Div Yield',
          sortingFn: (rowA, rowB) =>
            numSort(prices[rowA.original.ticker]?.dividend_yield, prices[rowB.original.ticker]?.dividend_yield),
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
        helper.accessor((row) => { const p = prices[row.ticker]?.price; const h = prices[row.ticker]?.high_52w; return (p && h) ? ((p - h) / h) * 100 : null }, {
          id: 'from52wHigh',
          header: '52W High',
          sortingFn: (rowA, rowB) => {
            const pct = (t: string) => {
              const p = prices[t]?.price
              const h = prices[t]?.high_52w
              return p && h ? ((p - h) / h) * 100 : null
            }
            return numSort(pct(rowA.original.ticker), pct(rowB.original.ticker))
          },
          cell: ({ row }) => {
            const t = row.original.ticker
            const price = prices[t]?.price
            const high = prices[t]?.high_52w
            if (!price || !high) return <span className="text-muted-foreground">—</span>
            const pct = ((price - high) / high) * 100
            return <span className={percentColor(pct)}>{formatRatio(pct)}%</span>
          },
        }),
        helper.accessor((row) => prices[row.ticker]?.expense_ratio ?? null, {
          id: 'expenseRatio',
          header: 'Exp. Ratio',
          sortingFn: (rowA, rowB) =>
            numSort(prices[rowA.original.ticker]?.expense_ratio, prices[rowB.original.ticker]?.expense_ratio),
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
        helper.accessor((row) => prices[row.ticker]?.aum ?? null, {
          id: 'aum',
          header: 'AUM',
          sortingFn: (rowA, rowB) =>
            numSort(toUsd(prices[rowA.original.ticker]?.aum, rowA.original.ticker),
                    toUsd(prices[rowB.original.ticker]?.aum, rowB.original.ticker)),
          cell: ({ row }) => {
            const t = row.original.ticker
            const a = toUsd(prices[t]?.aum, t)
            return <span className="tabular-nums">{formatMarketCap(a ?? undefined, mcSymbol(t))}</span>
          },
        }),
        helper.accessor((row) => prices[row.ticker]?.beta ?? null, {
          id: 'beta',
          header: 'Beta',
          sortingFn: (rowA, rowB) =>
            numSort(prices[rowA.original.ticker]?.beta, prices[rowB.original.ticker]?.beta),
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
        helper.accessor((row) => prices[row.ticker]?.profit_margins ?? null, {
          id: 'profitMargins',
          header: 'Net Margin',
          sortingFn: (rowA, rowB) =>
            numSort(prices[rowA.original.ticker]?.profit_margins, prices[rowB.original.ticker]?.profit_margins),
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
          enableSorting: false,
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
      ]
    },
    [prices, flashStates, returns, maxYears, onRemoveAsset, annualize, usd, toUsd, adjReturn, adj1d, mcSymbol]
  )

  const filteredAssets = useMemo(() => {
    const q = filterQuery.trim().toLowerCase()
    if (!q) return assets
    return assets.filter(
      (a) => a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    )
  }, [assets, filterQuery])

  const table = useReactTable({
    data: filteredAssets,
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

  // Columns hidden on mobile to reduce horizontal scrolling
  const MOBILE_HIDDEN = new Set(['3Y', '5Y', '10Y', 'MAX', 'expenseRatio', 'aum', 'beta', 'profitMargins', 'from52wHigh'])
  // Sticky left column on mobile
  const STICKY_LEFT = new Set(['ticker'])

  const colClass = (id: string, base = '') => {
    const sticky = STICKY_LEFT.has(id) ? 'sticky left-0 z-10 bg-background' : ''
    const hidden = MOBILE_HIDDEN.has(id) ? 'hidden md:table-cell' : ''
    return [base, sticky, hidden].filter(Boolean).join(' ')
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar — stacks vertically on mobile */}
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <div className="flex gap-2 flex-1 min-w-0">
          <div className="flex-1 min-w-0 max-w-xs">
            <TickerSearch onAdd={onAddAsset} existingTickers={tickers} />
          </div>
          <div className="relative w-36 shrink-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Filter…"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full rounded-sm border border-border bg-transparent pl-7 pr-7 py-1.5 text-xs font-ui placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setAnnualize((v) => !v)}
            title="Annualize returns for 3Y, 5Y, 10Y periods"
            className={`rounded-sm border px-2 py-1 font-mono text-xs tracking-wider uppercase transition-colors ${
              annualize
                ? 'bg-electric text-ink-void border-electric'
                : 'border-border text-muted-foreground hover:border-electric/50 hover:text-foreground'
            }`}
          >
            Ann.
          </button>
          <button
            onClick={() => setUsd((v) => !v)}
            title="Convert all values to USD using live FX rates"
            className={`rounded-sm border px-2 py-1 font-mono text-xs tracking-wider uppercase transition-colors ${
              usd
                ? 'bg-electric text-ink-void border-electric'
                : 'border-border text-muted-foreground hover:border-electric/50 hover:text-foreground'
            }`}
          >
            USD
          </button>
          <MetricsSelector selected={activeMetrics} onChange={handleMetricsChange} />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-sm border border-border">
        <table className="w-full font-ui text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border bg-ink-elevated">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className={colClass(header.id, 'px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap bg-ink-elevated')}
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
                              <ArrowUp className="h-3 w-3 text-electric" />
                            )}
                            {header.column.getIsSorted() === 'desc' && (
                              <ArrowDown className="h-3 w-3 text-electric" />
                            )}
                            {!header.column.getIsSorted() && (
                              <ArrowUpDown className="h-3 w-3 opacity-30" />
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
            {filteredAssets.length === 0 ? (
              <tr>
                <td
                  colSpan={table.getAllColumns().length}
                  className="py-12 text-center font-ui text-sm text-muted-foreground"
                >
                  {assets.length === 0
                    ? 'No assets yet. Use the search above to add tickers.'
                    : 'No assets match your filter.'}
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
                    <tr key={`cat-${cat}`} className="bg-ink-base border-b border-border/50">
                      <td
                        colSpan={visibleColCount}
                        className="px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70"
                      >
                        {cat}
                      </td>
                    </tr>
                  )
                }

                elements.push(
                  <tr
                    key={row.id}
                    className="group border-b border-border/50 cursor-pointer transition-colors hover:bg-ink-elevated last:border-0"
                    onClick={() => handleRowClick(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={colClass(cell.column.id, 'px-3 py-2.5 whitespace-nowrap')}
                      >
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
