'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { TickerSearch } from './TickerSearch'
import { FundamentalsPanel } from './FundamentalsPanel'
import { formatPrice, formatPercent, percentColor, annualizeReturn } from '@/lib/utils/formatters'
import { useFxData } from '@/hooks/useFxData'
import type { AssetMetadata, HistoricalDataPoint, QuoteData, AssetType, MetricKey } from '@/types'

const PEER_PERIOD_OPTIONS = ['1W', '1M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'] as const
type PeerPeriod = typeof PEER_PERIOD_OPTIONS[number]

const CHART_PERIODS = ['1M', 'YTD', '1Y', '3Y', '10Y', 'MAX'] as const
type ChartPeriod = typeof CHART_PERIODS[number]

// Periods > 1Y with a fixed known duration — annualizable
const ANNUALIZE_YEARS: Partial<Record<string, number>> = { '3Y': 3, '5Y': 5, '10Y': 10 }

const TYPE_COLORS: Record<string, string> = {
  stock: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  etf: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  index: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  fund: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  crypto: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
}

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
  const [history, setHistory] = useState<HistoricalDataPoint[]>([])
  const [loadingChart, setLoadingChart] = useState(false)
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('1Y')
  const [chartPeriodReturn, setChartPeriodReturn] = useState<number | null>(null)
  const [chartYears, setChartYears] = useState<number | null>(null)
  const [annualize, setAnnualize] = useState(false)
  const [usd, setUsd] = useState(false)

  const [peerMetrics, setPeerMetrics] = useState<PeerPeriod[]>(['1M', 'YTD', '1Y'])

  const [customPeers, setCustomPeers] = useState<AssetMetadata[]>([])
  const [removedInitialTickers, setRemovedInitialTickers] = useState<Set<string>>(new Set())

  const allPeers = useMemo(() => {
    const seen = new Set(initialPeers.map((p) => p.ticker))
    seen.add(asset?.ticker ?? '')
    const filtered = initialPeers.filter((p) => !removedInitialTickers.has(p.ticker))
    return [...filtered, ...customPeers.filter((p) => !seen.has(p.ticker))]
  }, [initialPeers, customPeers, asset, removedInitialTickers])

  const [peerQuotes, setPeerQuotes] = useState<Record<string, QuoteData>>({})
  const [peerReturns, setPeerReturns] = useState<Record<string, ReturnMap>>({})
  const [peerMaxYears, setPeerMaxYears] = useState<Record<string, number | null>>({})
  const [peerNames, setPeerNames] = useState<Record<string, string>>({})
  const [assetDisplayName, setAssetDisplayName] = useState<string | null>(null)

  // Reset on close
  useEffect(() => {
    if (!open) {
      setCustomPeers([])
      setRemovedInitialTickers(new Set())
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
      setCustomPeers((prev) => {
        if (prev.some((p) => p.ticker === ticker)) return prev
        return [
          ...prev,
          { ticker, name, type, sector: null, region: null, industry: null, benchmark: null, manager: null },
        ]
      })
    },
    []
  )

  const handleRemovePeer = useCallback((ticker: string) => {
    setCustomPeers((prev) => prev.filter((p) => p.ticker !== ticker))
  }, [])

  const togglePeerMetric = (period: PeerPeriod) => {
    setPeerMetrics((prev) =>
      prev.includes(period) ? prev.filter((p) => p !== period) : [...prev, period]
    )
  }

  if (!asset) return null

  const isPositive = (chartPeriodReturn ?? quote?.change_percent ?? 0) >= 0
  const existingPeerTickers = allPeers.map((p) => p.ticker)
  const customPeerTickers = new Set(customPeers.map((p) => p.ticker))

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-3xl w-full max-h-[90vh] flex flex-col"
        aria-describedby={undefined}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-3">
            <span className="font-mono text-2xl font-bold">{asset.ticker}</span>
            <span className="text-base font-normal text-muted-foreground">{assetDisplayName ?? asset.name}</span>
            <Badge
              variant="outline"
              className={`border-0 text-xs ${TYPE_COLORS[asset.type] ?? ''}`}
            >
              {asset.type}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Price header — return synced with selected chart period */}
          {quote && (
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold tabular-nums">{formatPrice(quote.price)}</span>
              {(() => {
                const years = ANNUALIZE_YEARS[chartPeriod] ?? (chartPeriod === 'MAX' ? chartYears : null)
                const displayReturn = annualize && years
                  ? annualizeReturn(chartPeriodReturn, years)
                  : chartPeriodReturn
                return (
                  <>
                    <span className={`text-lg font-semibold ${percentColor(displayReturn)}`}>
                      {formatPercent(displayReturn)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {chartPeriod}{annualize && years ? ' ann' : ''}
                    </span>
                  </>
                )
              })()}
            </div>
          )}

          {/* Chart period selector + chart */}
          <div>
            <div className="mb-2 flex gap-1">
              {CHART_PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setChartPeriod(p)}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    chartPeriod === p
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="h-48">
              {loadingChart ? (
                <Skeleton className="h-full w-full" />
              ) : history.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                    <defs>
                      <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor={isPositive ? '#22c55e' : '#ef4444'}
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor={isPositive ? '#22c55e' : '#ef4444'}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: string) => v.slice(5)}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      formatter={(v: number) => [formatPrice(v), 'Price']}
                    />
                    <Area
                      type="monotone"
                      dataKey="close"
                      stroke={isPositive ? '#22c55e' : '#ef4444'}
                      strokeWidth={2}
                      fill="url(#colorClose)"
                      dot={false}
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

          {/* Fundamentals section */}
          {quote && (
            <FundamentalsPanel quote={quote} assetType={asset.type} benchmark={asset.benchmark} />
          )}

          {/* Peers section */}
          <div>
            {/* Peers header: title + period toggles + ann toggle + search */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold shrink-0">Peers</span>

              <div className="flex flex-wrap gap-1">
                {PEER_PERIOD_OPTIONS.map((period) => (
                  <button
                    key={period}
                    onClick={() => togglePeerMetric(period)}
                    className={`rounded border px-2 py-0.5 text-xs font-medium transition-colors ${
                      peerMetrics.includes(period)
                        ? 'bg-foreground text-background border-foreground'
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
                className={`rounded border px-2 py-0.5 text-xs font-medium transition-colors ${
                  annualize
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'
                }`}
              >
                Ann.
              </button>

              <button
                onClick={() => setUsd((v) => !v)}
                title="Convert all values to USD using live FX rates"
                className={`rounded border px-2 py-0.5 text-xs font-medium transition-colors ${
                  usd
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'
                }`}
              >
                USD
              </button>

              <div className="flex-1 min-w-48 relative z-[100]">
                <TickerSearch
                  onAdd={handleAddCustomPeer}
                  existingTickers={existingPeerTickers}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
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
                      <tr key={asset.ticker} className="border-b bg-muted/30 font-semibold">
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
                    const isCustom = customPeerTickers.has(peer.ticker)
                    const displayPrice = usd ? toUsd(pq?.price, peer.ticker) : pq?.price
                    const display1d = adj1d(pq?.change_percent, peer.ticker)
                    return (
                      <tr key={peer.ticker} className="group border-b last:border-0">
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
                            onClick={() =>
                              isCustom
                                ? handleRemovePeer(peer.ticker)
                                : setRemovedInitialTickers((prev) => new Set([...prev, peer.ticker]))
                            }
                            className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
