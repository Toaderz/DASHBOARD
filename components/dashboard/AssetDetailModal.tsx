'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { X } from 'lucide-react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { TickerSearch } from './TickerSearch'
import { FundamentalsPanel } from './FundamentalsPanel'
import { AssetMonogram } from './AssetMonogram'
import { NumberTicker } from './NumberTicker'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SegmentedControl } from './SegmentedControl'
import { useChartTheme, chartTooltipStyle } from '@/lib/chart-theme'
import { assetLayoutId, morphTransition } from '@/lib/motion-tokens'
import { ValuePulse } from '@/lib/motion-client'
import { typeBadgeClass, typeLabel } from '@/lib/asset-style'
import { formatPrice, formatPercent, percentColor, annualizeReturn } from '@/lib/utils/formatters'
import { useFxData } from '@/hooks/useFxData'
import { usePeerSet } from '@/hooks/usePeerSet'
import { useCalendarYearReturns } from '@/hooks/useCalendarYearReturns'
import type { AssetMetadata, HistoricalDataPoint, QuoteData, AssetType, MetricKey } from '@/types'

const PEER_PERIOD_OPTIONS = ['1W', '1M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'] as const
type PeerPeriod = typeof PEER_PERIOD_OPTIONS[number]

const CHART_PERIODS = ['1M', 'YTD', '1Y', '3Y', '10Y', 'MAX'] as const
type ChartPeriod = typeof CHART_PERIODS[number]

type TabKey = 'summary' | 'calendar' | 'peers'

// Periods > 1Y with a fixed known duration — annualizable
const ANNUALIZE_YEARS: Partial<Record<string, number>> = { '3Y': 3, '5Y': 5, '10Y': 10 }

type ReturnMap = Partial<Record<PeerPeriod, number | null>>

interface AssetDetailModalProps {
  asset: AssetMetadata | null
  quote: QuoteData | null
  open: boolean
  onClose: () => void
  initialPeers: AssetMetadata[]
}

export function AssetDetailModal({
  asset,
  quote,
  open,
  onClose,
  initialPeers,
}: AssetDetailModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('summary')
  const [history, setHistory] = useState<HistoricalDataPoint[]>([])
  const [loadingChart, setLoadingChart] = useState(false)
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('1Y')
  const [chartPeriodReturn, setChartPeriodReturn] = useState<number | null>(null)
  const [chartYears, setChartYears] = useState<number | null>(null)
  const [annualize, setAnnualize] = useState(false)
  const [usd, setUsd] = useState(false)

  const [peerMetrics, setPeerMetrics] = useState<PeerPeriod[]>(['1M', 'YTD', '1Y'])
  const [peerChartPeriod, setPeerChartPeriod] = useState<PeerPeriod>('1Y')

  const chartTheme = useChartTheme()
  const reduced = useReducedMotion()

  // Persisted, per-user curated peer set (shared with the Beating-Peers page).
  // `initialPeers` is only a name/type hydration seed — the source of truth is the DB.
  const { peers: allPeers, addPeer, removePeer } = usePeerSet(open ? (asset?.ticker ?? null) : null, initialPeers)

  // Calendar-year returns — only fetched while the Calendar Years tab is active.
  const { data: calYears, loading: calLoading } = useCalendarYearReturns(
    open && activeTab === 'calendar' ? (asset?.ticker ?? null) : null
  )

  const [peerQuotes, setPeerQuotes] = useState<Record<string, QuoteData>>({})
  const [peerReturns, setPeerReturns] = useState<Record<string, ReturnMap>>({})
  const [peerMaxYears, setPeerMaxYears] = useState<Record<string, number | null>>({})
  const [peerNames, setPeerNames] = useState<Record<string, string>>({})
  const [assetDisplayName, setAssetDisplayName] = useState<string | null>(null)

  // Reset on close (peer curation is NOT reset — it lives in the DB now)
  useEffect(() => {
    if (!open) {
      setActiveTab('summary')
      setPeerQuotes({})
      setPeerReturns({})
      setPeerMaxYears({})
      setPeerNames({})
      setAssetDisplayName(null)
      setChartPeriodReturn(null)
      setChartYears(null)
      setAnnualize(false)
      setUsd(false)
    }
  }, [open])

  // Lookup real name for main asset when assets_metadata only has the ticker code as name
  useEffect(() => {
    if (!open || !asset) return
    const needsLookup = !asset.name || asset.name === asset.ticker
    if (!needsLookup) { setAssetDisplayName(null); return }
    fetch(`/api/market/search?q=${encodeURIComponent(asset.ticker)}`)
      .then((r) => r.json())
      .then((data: { results: Array<{ ticker: string; name: string }> }) => {
        const match = (data?.results ?? []).find(
          (r) => r.ticker.toUpperCase() === asset.ticker.toUpperCase()
        )
        if (match && match.name && match.name !== asset.ticker) {
          setAssetDisplayName(match.name)
        }
      })
      .catch(() => null)
  }, [open, asset])

  // Chart fetch
  useEffect(() => {
    if (!asset || !open) return
    setLoadingChart(true)
    setHistory([])
    fetch(`/api/market/history?ticker=${encodeURIComponent(asset.ticker)}&period=${chartPeriod}`)
      .then((r) => r.json())
      .then((d) => setHistory(d.data ?? []))
      .finally(() => setLoadingChart(false))
  }, [asset, open, chartPeriod])

  // Fetch return for the selected chart period so the header stays in sync
  useEffect(() => {
    if (!asset || !open) return
    setChartPeriodReturn(null)
    setChartYears(null)
    fetch(`/api/market/history?ticker=${encodeURIComponent(asset.ticker)}&period=${chartPeriod}&mode=return`)
      .then((r) => r.json())
      .then((d) => {
        setChartPeriodReturn(d.return ?? null)
        setChartYears(d.years ?? null)
      })
      .catch(() => { setChartPeriodReturn(null); setChartYears(null) })
  }, [asset, open, chartPeriod])

  // FX data for USD conversion
  const uniqueCurrencies = useMemo(() => {
    const currencies = Object.values(peerQuotes).map((q) => q.currency).filter((c): c is string => !!c)
    if (quote?.currency) currencies.push(quote.currency)
    return [...new Set(currencies)]
  }, [peerQuotes, quote])
  const { fxRates, fxPeriodReturns } = useFxData(uniqueCurrencies, peerMetrics as MetricKey[])

  const getCurrency = (ticker: string) =>
    (ticker === asset?.ticker ? quote?.currency : peerQuotes[ticker]?.currency) ?? 'USD'

  const toUsd = (value: number | null | undefined, ticker: string): number | null => {
    if (value == null || !usd) return value ?? null
    const c = getCurrency(ticker)
    if (!c || c === 'USD') return value
    const rate = fxRates[c]?.rate
    return rate != null ? value * rate : value
  }

  const adjReturn = (raw: number | null | undefined, ticker: string, period: PeerPeriod): number | null => {
    if (raw == null) return null
    if (!usd) return raw
    const c = getCurrency(ticker)
    if (!c || c === 'USD') return raw
    const fx = fxPeriodReturns[c]?.[period as MetricKey]
    if (fx == null) return raw
    return ((1 + raw / 100) * (1 + fx / 100) - 1) * 100
  }

  const adj1d = (raw: number | null | undefined, ticker: string): number | null => {
    if (raw == null) return null
    if (!usd) return raw
    const c = getCurrency(ticker)
    if (!c || c === 'USD') return raw
    const fxChange = fxRates[c]?.change1d
    if (fxChange == null) return raw
    return ((1 + raw / 100) * (1 + fxChange / 100) - 1) * 100
  }

  // Fetch names for peers not in the user's watchlists (their name fallback is the ticker itself).
  // Supabase assets_metadata only has watchlist tickers, so we use Yahoo search for unknowns.
  useEffect(() => {
    if (!open || allPeers.length === 0) return
    const unknown = allPeers.filter((p) => p.name === p.ticker)
    if (unknown.length === 0) return
    Promise.allSettled(
      unknown.map((p) =>
        fetch(`/api/market/search?q=${encodeURIComponent(p.ticker)}`)
          .then((r) => r.json())
          .then((data: { results: Array<{ ticker: string; name: string }> }) => {
            const list = data?.results ?? []
            const match = list.find((r) => r.ticker.toUpperCase() === p.ticker.toUpperCase())
            return match && match.name !== p.ticker ? { ticker: p.ticker, name: match.name } : null
          })
          .catch(() => null)
      )
    ).then((settled) => {
      const map: Record<string, string> = {}
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) map[r.value.ticker] = r.value.name
      }
      if (Object.keys(map).length > 0) setPeerNames((prev) => ({ ...prev, ...map }))
    })
  }, [open, allPeers])

  // Peer quotes fetch — includes the pinned asset so its data is always in peerQuotes
  useEffect(() => {
    if (!open || !asset) return
    const tickers = [asset.ticker, ...allPeers.map((p) => p.ticker)].join(',')
    fetch(`/api/market/quote?tickers=${encodeURIComponent(tickers)}`)
      .then((r) => r.json())
      .then((data) => setPeerQuotes(data))
  }, [open, allPeers, asset])

  // Peer returns fetch — includes the pinned asset
  useEffect(() => {
    if (!open || !asset || peerMetrics.length === 0) return
    const allTickers = [asset.ticker, ...allPeers.map((p) => p.ticker)]
    const pairs = allTickers.flatMap((ticker) =>
      peerMetrics.map((period) => ({ ticker, period }))
    )
    Promise.allSettled(
      pairs.map(({ ticker, period }) =>
        fetch(
          `/api/market/history?ticker=${encodeURIComponent(ticker)}&period=${period}&mode=return`
        )
          .then((r) => r.json())
          .then((d) => ({ ticker, period, value: (d.return ?? null) as number | null, years: (d.years ?? null) as number | null }))
      )
    ).then((results) => {
      const map: Record<string, ReturnMap> = {}
      const yearsMap: Record<string, number | null> = {}
      for (const r of results) {
        if (r.status !== 'fulfilled') continue
        const { ticker, period, value, years } = r.value
        if (!map[ticker]) map[ticker] = {}
        map[ticker][period] = value
        if (period === 'MAX') yearsMap[ticker] = years
      }
      setPeerReturns((prev) => ({ ...prev, ...map }))
      setPeerMaxYears((prev) => ({ ...prev, ...yearsMap }))
    })
  }, [open, allPeers, peerMetrics, asset])

  const handleAddCustomPeer = useCallback(
    async (ticker: string, name: string, type: AssetType) => {
      addPeer(ticker, name, type)
    },
    [addPeer]
  )

  const handleRemovePeer = useCallback((ticker: string) => {
    removePeer(ticker)
  }, [removePeer])

  const togglePeerMetric = (period: PeerPeriod) => {
    setPeerMetrics((prev) =>
      prev.includes(period) ? prev.filter((p) => p !== period) : [...prev, period]
    )
  }

  if (!asset) return null

  const isPositive = (chartPeriodReturn ?? quote?.change_percent ?? 0) >= 0
  const areaColor = isPositive ? chartTheme.gain : chartTheme.loss
  const existingPeerTickers = allPeers.map((p) => p.ticker)

  // Peer comparison bar data (asset + peers) for one selected period — reuses fetched returns.
  const effectivePeerChartPeriod = peerMetrics.includes(peerChartPeriod) ? peerChartPeriod : peerMetrics[0]
  const peerChartData = (() => {
    if (!effectivePeerChartPeriod) return [] as Array<{ ticker: string; value: number; isAsset: boolean }>
    const rows = [
      { ticker: asset.ticker, isAsset: true },
      ...allPeers.map((p) => ({ ticker: p.ticker, isAsset: false })),
    ]
    return rows
      .map(({ ticker, isAsset }) => {
        const raw = adjReturn(peerReturns[ticker]?.[effectivePeerChartPeriod], ticker, effectivePeerChartPeriod)
        const years = ANNUALIZE_YEARS[effectivePeerChartPeriod] ?? (effectivePeerChartPeriod === 'MAX' ? (peerMaxYears[ticker] ?? null) : null)
        const v = annualize && years ? annualizeReturn(raw, years) : raw
        return { ticker, value: v, isAsset }
      })
      .filter((d): d is { ticker: string; value: number; isAsset: boolean } => d.value != null)
  })()

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-3xl w-full max-h-[90vh] flex flex-col"
        aria-describedby={undefined}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Shared element — the table row's monogram+ticker morphs into this on open */}
            <motion.span
              layoutId={reduced ? undefined : assetLayoutId(asset.ticker)}
              transition={morphTransition}
              className="flex items-center gap-2.5"
            >
              <AssetMonogram ticker={asset.ticker} size="md" />
              <span className="font-mono text-2xl font-bold tracking-tight">{asset.ticker}</span>
            </motion.span>
            <span className="min-w-0 flex-1 truncate text-base font-normal text-muted-foreground">{assetDisplayName ?? asset.name}</span>
            <Badge
              variant="outline"
              className={`shrink-0 border-0 text-xs ${typeBadgeClass(asset.type)}`}
            >
              {typeLabel(asset.type)}
            </Badge>
            {quote && (
              <ValuePulse value={quote.price} tone="auto" className="ml-auto">
                <span className="font-editorial text-2xl font-bold tabular-nums text-foreground">
                  <NumberTicker target={quote.price} format={(v) => formatPrice(v)} />
                </span>
              </ValuePulse>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabKey)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="shrink-0 self-start">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="calendar">Calendar Years</TabsTrigger>
            <TabsTrigger value="peers">Peers</TabsTrigger>
          </TabsList>

          <div className="mt-3 flex-1 overflow-y-auto pr-1">
            <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
            {/* ── Summary ───────────────────────────────────────────────── */}
            <TabsContent value="summary" className="space-y-4">
              {(() => {
                const years = ANNUALIZE_YEARS[chartPeriod] ?? (chartPeriod === 'MAX' ? chartYears : null)
                const displayReturn = annualize && years
                  ? annualizeReturn(chartPeriodReturn, years)
                  : chartPeriodReturn
                return (
                  <div className="flex items-baseline gap-2">
                    <span className={`font-editorial text-2xl font-bold tabular-nums tracking-[-0.02em] ${percentColor(displayReturn)}`}>
                      {formatPercent(displayReturn)}
                    </span>
                    <span className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
                      {chartPeriod}{annualize && years ? ' ann' : ''}
                    </span>
                  </div>
                )
              })()}

              <div>
                <div className="mb-2">
                  <SegmentedControl
                    aria-label="Chart period"
                    size="sm"
                    options={CHART_PERIODS.map((p) => ({ value: p, label: p }))}
                    value={chartPeriod}
                    onChange={(p) => setChartPeriod(p as ChartPeriod)}
                  />
                </div>
                <div className="h-48">
                  {loadingChart ? (
                    <Skeleton className="h-full w-full" />
                  ) : history.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                        <defs>
                          <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={areaColor} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={areaColor} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10, fill: chartTheme.axis }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v: string) => v.slice(5)}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: chartTheme.axis }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip
                          contentStyle={chartTooltipStyle(chartTheme)}
                          formatter={(v: number) => [formatPrice(v), 'Price']}
                        />
                        <Area
                          type="monotone"
                          dataKey="close"
                          stroke={areaColor}
                          strokeWidth={2}
                          fill="url(#colorClose)"
                          dot={false}
                          isAnimationActive={!reduced}
                          animationDuration={reduced ? 0 : 600}
                          animationEasing="ease-out"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      No chart data available
                    </div>
                  )}
                </div>
              </div>

              {quote && (
                <FundamentalsPanel quote={quote} assetType={asset.type} benchmark={asset.benchmark} />
              )}
            </TabsContent>

            {/* ── Calendar Years ────────────────────────────────────────── */}
            <TabsContent value="calendar" className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Retorno por año calendario (precio, moneda local).
              </p>
              <div className="h-56">
                {calLoading ? (
                  <Skeleton className="h-full w-full" />
                ) : calYears.some((d) => d.return != null) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={calYears} margin={{ top: 8, right: 4, left: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                      <XAxis
                        dataKey="year"
                        tick={{ fontSize: 10, fill: chartTheme.axis }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: chartTheme.axis }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                      />
                      <Tooltip
                        contentStyle={chartTooltipStyle(chartTheme)}
                        formatter={(v: number) => [formatPercent(v), 'Return']}
                      />
                      <Bar dataKey="return" radius={[3, 3, 0, 0]} isAnimationActive={!reduced} animationDuration={reduced ? 0 : 600} animationEasing="ease-out">
                        {calYears.map((d) => (
                          <Cell key={d.year} fill={(d.return ?? 0) >= 0 ? chartTheme.gain : chartTheme.loss} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No calendar-year data available
                  </div>
                )}
              </div>

              {/* Fallback table */}
              {calYears.length > 0 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {calYears.map((d) => (
                    <div key={d.year} className="rounded-card border border-border bg-card p-2">
                      <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">{d.year}</div>
                      <div className={`text-sm font-mono font-semibold tabular-nums ${percentColor(d.return)}`}>
                        {formatPercent(d.return)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Peers ─────────────────────────────────────────────────── */}
            <TabsContent value="peers" className="space-y-4">
              {/* Controls: period toggles + ann/usd + search */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="shrink-0 text-sm font-semibold">Peers</span>

                <div className="flex flex-wrap gap-1">
                  {PEER_PERIOD_OPTIONS.map((period) => (
                    <button
                      key={period}
                      onClick={() => togglePeerMetric(period)}
                      className={`focus-ring rounded-pill border px-2 py-0.5 text-xs font-medium transition-colors ${
                        peerMetrics.includes(period)
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'
                      }`}
                    >
                      {period}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setAnnualize((v) => !v)}
                  title="Annualize returns for 3Y, 5Y, 10Y periods"
                  className={`focus-ring rounded-pill border px-2 py-0.5 text-xs font-medium transition-colors ${
                    annualize
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'
                  }`}
                >
                  Ann.
                </button>

                <button
                  onClick={() => setUsd((v) => !v)}
                  title="Convert all values to USD using live FX rates"
                  className={`focus-ring rounded-pill border px-2 py-0.5 text-xs font-medium transition-colors ${
                    usd
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'
                  }`}
                >
                  USD
                </button>

                <div className="relative z-[100] min-w-48 flex-1">
                  <TickerSearch
                    onAdd={handleAddCustomPeer}
                    existingTickers={existingPeerTickers}
                  />
                </div>
              </div>

              {/* Comparison bar chart (asset vs peers) for one period */}
              {peerMetrics.length > 0 && peerChartData.length > 0 && (
                <div className="rounded-card border border-border bg-card p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                      Vs peers{usd ? ' · USD' : ''}
                    </span>
                    <SegmentedControl
                      aria-label="Peer chart period"
                      size="sm"
                      options={peerMetrics.map((p) => ({ value: p, label: p }))}
                      value={effectivePeerChartPeriod}
                      onChange={(p) => setPeerChartPeriod(p as PeerPeriod)}
                    />
                  </div>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={peerChartData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                        <XAxis
                          dataKey="ticker"
                          tick={{ fontSize: 9, fill: chartTheme.axis }}
                          tickLine={false}
                          axisLine={false}
                          interval={0}
                          angle={-30}
                          textAnchor="end"
                          height={44}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: chartTheme.axis }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                        />
                        <Tooltip
                          contentStyle={chartTooltipStyle(chartTheme)}
                          formatter={(v: number) => [formatPercent(v), effectivePeerChartPeriod]}
                        />
                        <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={!reduced} animationDuration={reduced ? 0 : 600} animationEasing="ease-out">
                          {peerChartData.map((d) => (
                            <Cell
                              key={d.ticker}
                              fill={d.value >= 0 ? chartTheme.gain : chartTheme.loss}
                              stroke={d.isAsset ? chartTheme.series[0] : undefined}
                              strokeWidth={d.isAsset ? 2 : 0}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Peer table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="pb-1 text-left font-medium">Ticker</th>
                      <th className="pb-1 text-left font-medium">Name</th>
                      <th className="pb-1 text-right font-medium">Price</th>
                      <th className="pb-1 text-right font-medium">1D %</th>
                      {peerMetrics.map((p) => (
                        <th key={p} className="pb-1 text-right font-medium">
                          {p} %{annualize && (ANNUALIZE_YEARS[p] || p === 'MAX') ? <span className="text-[10px] text-muted-foreground ml-0.5">ann</span> : null}
                        </th>
                      ))}
                      <th className="pb-1 w-5" />
                    </tr>
                  </thead>
                  <tbody>
                    {/* Pinned row — the asset being viewed, always first, not removable */}
                    {(() => {
                      const pq = peerQuotes[asset.ticker]
                      const displayPrice = usd ? toUsd(pq?.price ?? quote?.price, asset.ticker) : (pq?.price ?? quote?.price)
                      const display1d = adj1d(pq?.change_percent ?? quote?.change_percent, asset.ticker)
                      return (
                        <tr key={asset.ticker} className="border-b border-border bg-foreground/[0.04] font-semibold">
                          <td className="py-1 font-mono">{asset.ticker}</td>
                          <td className="py-1 max-w-[140px] truncate">{assetDisplayName ?? asset.name}</td>
                          <td className="py-1 text-right tabular-nums">
                            {formatPrice(displayPrice, usd ? 'USD' : (pq?.currency ?? quote?.currency ?? 'USD'))}
                          </td>
                          <td className={`py-1 text-right tabular-nums ${percentColor(display1d)}`}>
                            {formatPercent(display1d)}
                          </td>
                          {peerMetrics.map((period) => {
                            const raw = adjReturn(peerReturns[asset.ticker]?.[period], asset.ticker, period)
                            const years = ANNUALIZE_YEARS[period] ?? (period === 'MAX' ? (peerMaxYears[asset.ticker] ?? null) : null)
                            const v = annualize && years ? annualizeReturn(raw, years) : raw
                            return (
                              <td key={period} className={`py-1 text-right tabular-nums ${percentColor(v)}`}>
                                {formatPercent(v)}
                              </td>
                            )
                          })}
                          <td className="py-1 w-5" />
                        </tr>
                      )
                    })()}
                    {allPeers.length === 0 && (
                      <tr>
                        <td colSpan={4 + peerMetrics.length + 1} className="py-3 text-center text-xs text-muted-foreground">
                          No peers. Use the search above to add them.
                        </td>
                      </tr>
                    )}
                    {allPeers.map((peer) => {
                      const pq = peerQuotes[peer.ticker]
                      const displayPrice = usd ? toUsd(pq?.price, peer.ticker) : pq?.price
                      const display1d = adj1d(pq?.change_percent, peer.ticker)
                      return (
                        <tr key={peer.ticker} className="group border-b border-border last:border-0">
                          <td className="py-1 font-mono font-semibold">{peer.ticker}</td>
                          <td className="py-1 text-muted-foreground max-w-[140px] truncate">
                            {peerNames[peer.ticker] ?? peer.name}
                          </td>
                          <td className="py-1 text-right tabular-nums">
                            {formatPrice(displayPrice, usd ? 'USD' : (pq?.currency ?? 'USD'))}
                          </td>
                          <td className={`py-1 text-right tabular-nums ${percentColor(display1d)}`}>
                            {formatPercent(display1d)}
                          </td>
                          {peerMetrics.map((period) => {
                            const raw = adjReturn(peerReturns[peer.ticker]?.[period], peer.ticker, period)
                            const years = ANNUALIZE_YEARS[period] ?? (period === 'MAX' ? (peerMaxYears[peer.ticker] ?? null) : null)
                            const v = annualize && years ? annualizeReturn(raw, years) : raw
                            return (
                              <td key={period} className={`py-1 text-right tabular-nums ${percentColor(v)}`}>
                                {formatPercent(v)}
                              </td>
                            )
                          })}
                          <td className="py-1 text-right">
                            <button
                              onClick={() => handleRemovePeer(peer.ticker)}
                              className="focus-ring text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </TabsContent>
            </motion.div>
            </AnimatePresence>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
