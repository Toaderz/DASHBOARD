'use client'

import { useState, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type VisibilityState,
  type ColumnOrderState,
} from '@tanstack/react-table'
import { ArrowUpDown, ArrowUp, ArrowDown, X, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PriceCell } from './PriceCell'
import { AssetMonogram } from './AssetMonogram'
import { MetricsSelector } from './MetricsSelector'
import { TickerSearch } from './TickerSearch'
// Lazy: the modal pulls in Recharts — defer its chunk until the first asset click.
const AssetDetailModal = dynamic(
  () => import('./AssetDetailModal').then((m) => m.AssetDetailModal),
  { ssr: false }
)
import { useRealtimePrices } from '@/hooks/useRealtimePrices'
import { usePerformanceMetrics } from '@/hooks/usePerformanceMetrics'
import { createClient } from '@/lib/supabase/client'
import { formatPercent, formatMarketCap, formatRatio, formatExpenseRatio, percentColor, annualizeReturn, getCurrencySymbol } from '@/lib/utils/formatters'
import { useFxData } from '@/hooks/useFxData'
import { METRIC_DEFINITIONS } from '@/types'
import type { AssetMetadata, AssetWithCategory, MetricKey, Watchlist, AssetType } from '@/types'
import { computeInitialPeers } from '@/lib/market/peer-taxonomy'
import { cn } from '@/lib/utils/cn'
import { colClass, pillClass, isNumericCol } from '@/lib/watchlist-table-style'
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { assetLayoutId, morphTransition } from '@/lib/motion-tokens'

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
  const [showAutoPeers, setShowAutoPeers] = useState(true)
  const hasAutoPeers = useMemo(() => assets.some((a) => a.source === 'auto-peer'), [assets])

  // Years for annualizable periods (>1Y with fixed duration)
  const ANNUALIZE_YEARS: Partial<Record<string, number>> = { '3Y': 3, '5Y': 5, '10Y': 10 }

  const reduced = useReducedMotion()
  const tickers = useMemo(() => assets.map((a) => a.ticker), [assets])
  // Un mismo ticker puede aparecer en varias categorías (p.ej. THEMATICS repite ^GSPC/CIBR/FAI).
  // El layoutId del shared-element morph DEBE ser único en la página: con duplicados, Framer Motion
  // colapsa una de las instancias (la fila "desaparece"). Para esos tickers desactivamos el layoutId
  // (se pierde solo el morph en duplicados; la fila renderiza normal). Los tickers únicos lo conservan.
  const dupTickers = useMemo(() => {
    const seen = new Set<string>()
    const dup = new Set<string>()
    for (const t of tickers) {
      if (seen.has(t)) dup.add(t)
      else seen.add(t)
    }
    return dup
  }, [tickers])
  const { prices, flashStates } = useRealtimePrices(tickers)
  const activeMetrics = watchlist.selected_metrics as MetricKey[]
  const { returns, maxYears } = usePerformanceMetrics(tickers, prices, activeMetrics)

  const RETURN_PERIODS_SET = new Set(['1W', '1M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX', 'CY2025', 'CY2024', 'CY2023', 'CY2022', 'CY2021', 'CY2020', 'CY2019'])
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

  // Returns null for MAX (always valid) or an ISO date string for the period's start date
  const periodStartDate = useCallback((period: string): string | null => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()
    const d = now.getDate()
    switch (period) {
      case '1W':  return new Date(y, m, d - 7).toISOString().split('T')[0]
      case '1M':  return new Date(y, m - 1, d).toISOString().split('T')[0]
      case '6M':  return new Date(y, m - 6, d).toISOString().split('T')[0]
      case 'YTD': return `${y}-01-01`
      case '1Y':  return new Date(y - 1, m, d).toISOString().split('T')[0]
      case '3Y':  return new Date(y - 3, m, d).toISOString().split('T')[0]
      case '5Y':  return new Date(y - 5, m, d).toISOString().split('T')[0]
      case '10Y':   return new Date(y - 10, m, d).toISOString().split('T')[0]
      case 'CY2025': return '2025-01-01'
      case 'CY2024': return '2024-01-01'
      case 'CY2023': return '2023-01-01'
      case 'CY2022': return '2022-01-01'
      case 'CY2021': return '2021-01-01'
      case 'CY2020': return '2020-01-01'
      case 'CY2019': return '2019-01-01'
      default:    return null
    }
  }, [])

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
            <span className="flex items-center gap-2">
              <motion.span
                layoutId={reduced || dupTickers.has(row.original.ticker) ? undefined : assetLayoutId(row.original.ticker)}
                transition={morphTransition}
                className="flex items-center gap-2"
              >
                <AssetMonogram ticker={row.original.ticker} size="sm" />
                <span className="font-mono text-xs font-bold tracking-wider text-foreground">{row.original.ticker}</span>
              </motion.span>
              {row.original.source === 'auto-peer' && (
                <span
                  title={`Peer auto-resuelto${row.original.peer_of ? ` de ${row.original.peer_of}` : ''}`}
                  className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border border-border rounded px-1 py-0.5 leading-none"
                >
                  peer
                </span>
              )}
            </span>
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
            return <span className={`tabular-nums font-semibold ${percentColor(v)}`}>{formatPercent(v)}</span>
          },
        }),
        ...(['1W', '1M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX', 'CY2025', 'CY2024', 'CY2023', 'CY2022', 'CY2021', 'CY2020', 'CY2019'] as MetricKey[]).map((period) =>
          helper.accessor((row) => returns[row.ticker]?.[period] ?? null, {
            id: period,
            header: () => {
              const isAnnualizable = !!ANNUALIZE_YEARS[period] || period === 'MAX'
              return <span>{period} %{annualize && isAnnualizable ? <span className="text-[10px] text-muted-foreground ml-0.5">ann</span> : null}</span>
            },
            sortingFn: (rowA, rowB) => {
              const getVal = (ticker: string) => {
                const inception = prices[ticker]?.inception_date
                const start = periodStartDate(period)
                if (inception && start && inception > start) return null
                const raw = adjReturn(returns[ticker]?.[period], ticker, period)
                const years = ANNUALIZE_YEARS[period] ?? (period === 'MAX' ? (maxYears[ticker] ?? null) : null)
                const canAnnualize = years != null && years >= 1
                return annualize && canAnnualize ? annualizeReturn(raw, years!) : raw
              }
              return numSort(getVal(rowA.original.ticker), getVal(rowB.original.ticker))
            },
            cell: ({ row }) => {
              const t = row.original.ticker
              const inception = prices[t]?.inception_date
              const start = periodStartDate(period)
              if (inception && start && inception > start) {
                return <span className="text-muted-foreground">—</span>
              }
              const raw = adjReturn(returns[t]?.[period], t, period)
              const years = ANNUALIZE_YEARS[period] ?? (period === 'MAX' ? (maxYears[t] ?? null) : null)
              const canAnnualize = years != null && years >= 1
              const v = annualize && canAnnualize ? annualizeReturn(raw, years!) : raw
              return <span className={`tabular-nums font-semibold ${percentColor(v)}`}>{formatPercent(v)}</span>
            },
          })
        ),
        helper.accessor((row) => prices[row.ticker]?.market_cap ?? null, {
          id: 'marketCap',
          header: 'Mkt Cap',
          sortingFn: (rowA, rowB) =>
            numSort(prices[rowA.original.ticker]?.market_cap, prices[rowB.original.ticker]?.market_cap),
          cell: ({ row }) => {
            const t = row.original.ticker
            const mc = prices[t]?.market_cap
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
            return <span className={`tabular-nums font-semibold ${percentColor(pct)}`}>{formatRatio(pct)}%</span>
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
            numSort(prices[rowA.original.ticker]?.aum, prices[rowB.original.ticker]?.aum),
          cell: ({ row }) => {
            const t = row.original.ticker
            const a = prices[t]?.aum
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
        helper.accessor((row) => prices[row.ticker]?.inception_date ?? null, {
          id: 'inceptionDate',
          header: 'Inception',
          sortingFn: (rowA, rowB) => {
            const a = prices[rowA.original.ticker]?.inception_date ?? null
            const b = prices[rowB.original.ticker]?.inception_date ?? null
            if (a == null && b == null) return 0
            if (a == null) return 1
            if (b == null) return -1
            return a < b ? -1 : a > b ? 1 : 0
          },
          cell: ({ row }) => {
            const d = prices[row.original.ticker]?.inception_date
            if (!d) return <span className="text-muted-foreground">—</span>
            const [y, m, day] = d.split('-')
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
            return <span className="tabular-nums text-xs">{months[parseInt(m)-1]} {parseInt(day)}, {y}</span>
          },
        }),
        helper.display({
          id: 'morningstarCategory',
          header: 'MS Category',
          enableSorting: false,
          cell: ({ row }) => {
            const c = prices[row.original.ticker]?.morningstar_category
            return c
              ? <span className="text-xs truncate max-w-[120px] block">{c}</span>
              : <span className="text-muted-foreground">—</span>
          },
        }),
        helper.display({
          id: 'globalCategory',
          header: 'Global Cat.',
          enableSorting: false,
          cell: ({ row }) => {
            const c = prices[row.original.ticker]?.global_category
            return c
              ? <span className="text-xs truncate max-w-[140px] block">{c}</span>
              : <span className="text-muted-foreground">—</span>
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
    [prices, flashStates, returns, maxYears, onRemoveAsset, annualize, usd, toUsd, adjReturn, adj1d, mcSymbol, periodStartDate, reduced, dupTickers]
  )

  const columnOrder = useMemo<ColumnOrderState>(
    () => ['ticker', 'name', 'price', 'currency', ...activeMetrics, 'actions'],
    [activeMetrics]
  )

  const filteredAssets = useMemo(() => {
    const q = filterQuery.trim().toLowerCase()
    let list = showAutoPeers ? assets : assets.filter((a) => a.source !== 'auto-peer')
    if (q) list = list.filter((a) => a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
    return list
  }, [assets, filterQuery, showAutoPeers])

  const table = useReactTable({
    data: filteredAssets,
    columns,
    state: { sorting, columnVisibility, columnOrder },
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
    <LayoutGroup>
    <div className="flex flex-col gap-3">
      {/* Toolbar — stacks vertically on mobile; sticks to the top on scroll */}
      <div className="sticky top-0 z-20 flex flex-col gap-2 border-b border-border/60 bg-background/80 pb-3 backdrop-blur-sm md:flex-row md:flex-wrap md:items-center">
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
              className="w-full rounded-md border border-border bg-ink-elevated/40 pl-7 pr-7 py-1.5 text-xs font-ui placeholder:text-muted-foreground/70 transition-colors focus:outline-none focus:border-foreground/40"
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
            className={pillClass(annualize)}
          >
            Ann.
          </button>
          <button
            onClick={() => setUsd((v) => !v)}
            title="Convert all values to USD using live FX rates"
            className={pillClass(usd)}
          >
            USD
          </button>
          {hasAutoPeers && (
            <button
              onClick={() => setShowAutoPeers((v) => !v)}
              title="Mostrar u ocultar los peers resueltos automáticamente (agrupados bajo cada activo)"
              className={pillClass(showAutoPeers)}
            >
              Peers
            </button>
          )}
          <MetricsSelector selected={activeMetrics} onChange={handleMetricsChange} />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-card border border-border shadow-card">
        <table className="w-full font-ui text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b-2 border-border/80 bg-ink-elevated">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className={colClass(header.id, 'px-3.5 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground whitespace-nowrap bg-ink-elevated')}
                  >
                    {header.isPlaceholder ? null : (
                      <button
                        className={cn('flex items-center gap-1', isNumericCol(header.id) && 'w-full justify-end')}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <>
                            {header.column.getIsSorted() === 'asc' && (
                              <ArrowUp className="h-3 w-3 text-spark" />
                            )}
                            {header.column.getIsSorted() === 'desc' && (
                              <ArrowDown className="h-3 w-3 text-spark" />
                            )}
                            {!header.column.getIsSorted() && (
                              <ArrowUpDown className="h-3 w-3 text-muted-foreground opacity-40" />
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
                    <tr key={`cat-${cat}`} className="border-y border-border/40 bg-ink-base/60">
                      <td
                        colSpan={visibleColCount}
                        className="px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60"
                      >
                        {cat}
                      </td>
                    </tr>
                  )
                }

                const isSelected = selectedAsset?.ticker === row.original.ticker
                elements.push(
                  <tr
                    key={row.id}
                    className={cn(
                      'group border-b border-border/50 cursor-pointer transition-colors hover:bg-ink-elevated last:border-0',
                      isSelected && 'bg-spark/[0.04]'
                    )}
                    onClick={() => handleRowClick(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={colClass(
                          cell.column.id,
                          cn('px-3.5 py-3 align-middle whitespace-nowrap',
                            isSelected && cell.column.id === 'ticker' && 'shadow-[inset_2px_0_0_0_hsl(var(--electric))]')
                        )}
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

      {/* Loading skeletons — matched to the table surface */}
      {tickers.length > 0 && Object.keys(prices).length === 0 && (
        <div className="space-y-2 rounded-card border border-border bg-ink-surface/40 p-3">
          {tickers.map((t) => (
            <Skeleton key={t} className="h-10 w-full" />
          ))}
        </div>
      )}

      {/* Detail Modal — only mounted once an asset has been selected (defers Recharts chunk) */}
      {selectedAsset && (
        <AssetDetailModal
          asset={selectedAsset}
          quote={prices[selectedAsset.ticker] ?? null}
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          initialPeers={initialPeers}
        />
      )}
    </div>
    </LayoutGroup>
  )
}
