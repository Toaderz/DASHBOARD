'use client'

import { useEffect, useMemo, useState } from 'react'
import { GitCompare } from 'lucide-react'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { SegmentedControl } from '@/components/dashboard/SegmentedControl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { pillClass } from '@/lib/watchlist-table-style'
import {
  formatPercent, formatMarketCap, formatRatio, formatExpenseRatio,
} from '@/lib/utils/formatters'
import type { AssetType, QuoteData } from '@/types'
import { useCompareTickers, MAX_COMPARE_TICKERS } from '@/hooks/useCompareTickers'
import { useEtfComparison, COMPARE_TRAILING_PERIODS } from '@/hooks/useEtfComparison'
import { compatGroup, groupLockReason, instrumentToType, type CompareGroup } from './compare-utils'
import { CompareTickerBar } from './CompareTickerBar'
import { CompareHero } from './CompareHero'
import { CompareMetricsTable, type MetricRow, type MetricCell } from './CompareMetricsTable'
import { CompareGrowthChart, type GrowthRange } from './CompareGrowthChart'
import { CompareAnnualReturns } from './CompareAnnualReturns'
import { CompareHoldings } from './CompareHoldings'

const RANGE_OPTIONS = [
  { value: '1Y' as GrowthRange, label: '1Y' },
  { value: '3Y' as GrowthRange, label: '3Y' },
  { value: '5Y' as GrowthRange, label: '5Y' },
]

const pct2 = (v: number) => `${v.toFixed(2)}%`

export function EtfCompare() {
  const { tickers, add, remove, reset, atCap } = useCompareTickers()
  const cmp = useEtfComparison(tickers)
  const { quotes, trailingByTicker, annualByTicker, seriesByTicker, historyLoading } = cmp

  const [meta, setMeta] = useState<Record<string, { name: string; type: AssetType }>>({})
  const [highlight, setHighlight] = useState(false)
  const [range, setRange] = useState<GrowthRange>('1Y')
  const [activeTab, setActiveTab] = useState('overview')

  const handleAdd = (ticker: string, name: string, type: AssetType) => {
    setMeta((m) => ({ ...m, [ticker]: { name, type } }))
    add(ticker)
  }

  // Asset type per ticker: prefer the live quote's instrument_type, fall back to the
  // type captured at add-time (needed before quotes load / on reload).
  const typeByTicker = useMemo(() => {
    const map: Record<string, AssetType> = {}
    for (const t of tickers) {
      const fromQuote = quotes[t]?.instrument_type ? instrumentToType(quotes[t]?.instrument_type) : undefined
      map[t] = fromQuote ?? meta[t]?.type ?? 'stock'
    }
    return map
  }, [tickers, quotes, meta])

  // The comparison group is locked by the first ticker; search disables other groups.
  const group: CompareGroup | null = tickers.length > 0 ? compatGroup(typeByTicker[tickers[0]]) : null

  const names = useMemo(() => {
    const map: Record<string, string> = {}
    for (const t of tickers) map[t] = quotes[t]?.name || meta[t]?.name || t
    return map
  }, [tickers, quotes, meta])

  const disabledFor = useMemo(
    () => (result: { type: AssetType }) => {
      if (atCap) return `Máximo ${MAX_COMPARE_TICKERS} activos`
      if (group && compatGroup(result.type) !== group) return groupLockReason(group)
      return undefined
    },
    [atCap, group]
  )

  // ── Row builders ──────────────────────────────────────────────────────────
  const numCell = (v: number | null | undefined, fmt: (n: number) => string): MetricCell =>
    v == null ? { num: null, text: '—' } : { num: v, text: fmt(v) }
  const textCell = (s: string | null | undefined): MetricCell => ({ num: null, text: s || '—' })

  const buildRow = (
    id: string,
    label: string,
    direction: MetricRow['direction'],
    cell: (t: string, q: QuoteData | undefined) => MetricCell,
    opts?: Partial<Pick<MetricRow, 'colorBySign' | 'hint'>>
  ): MetricRow => {
    const values: Record<string, MetricCell> = {}
    for (const t of tickers) values[t] = cell(t, quotes[t])
    return { id, label, direction, values, ...opts }
  }

  const overviewRows = useMemo<MetricRow[]>(() => {
    if (group === 'stock' || group === 'crypto') {
      return [
        buildRow('marketCap', 'Market Cap', 'higher', (_t, q) => numCell(q?.market_cap, (v) => formatMarketCap(v, '$'))),
        buildRow('pe', 'P/E', 'none', (_t, q) => numCell(q?.pe, formatRatio)),
        buildRow('sector', 'Sector', 'none', (_t, q) => textCell(q?.sector)),
        buildRow('industry', 'Industria', 'none', (_t, q) => textCell(q?.industry)),
        buildRow('country', 'País', 'none', (_t, q) => textCell(q?.country)),
      ]
    }
    // etf / fund / index
    return [
      buildRow('issuer', 'Emisor', 'none', (_t, q) => textCell(q?.fund_family)),
      buildRow('expense', 'Expense Ratio', 'lower', (_t, q) => numCell(q?.expense_ratio, formatExpenseRatio), { hint: 'Menor es mejor' }),
      buildRow('aum', 'AUM', 'higher', (_t, q) => numCell(q?.aum, (v) => formatMarketCap(v, '$'))),
      buildRow('inception', 'Inception', 'none', (_t, q) => textCell(q?.inception_date)),
      buildRow('category', 'Categoría', 'none', (_t, q) => textCell(q?.morningstar_category)),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers, quotes, group])

  const riskRows = useMemo<MetricRow[]>(() => {
    if (group === 'stock' || group === 'crypto') {
      return [
        buildRow('beta', 'Beta', 'none', (_t, q) => numCell(q?.beta, formatRatio)),
        buildRow('divYield', 'Dividend Yield', 'higher', (_t, q) => numCell(q?.dividend_yield, pct2)),
        buildRow('netMargin', 'Net Margin', 'higher', (_t, q) => numCell(q?.profit_margins, pct2)),
      ]
    }
    return [
      buildRow('beta', 'Beta', 'none', (_t, q) => numCell(q?.beta, formatRatio)),
      buildRow('stdDev', 'Std Dev', 'lower', (_t, q) => numCell(q?.std_dev, pct2), { hint: 'Menor es mejor' }),
      buildRow('sharpe', 'Sharpe', 'higher', (_t, q) => numCell(q?.sharpe, formatRatio)),
      buildRow('alpha', 'Alpha', 'higher', (_t, q) => numCell(q?.alpha, formatRatio)),
      buildRow('divYield', 'Dividend Yield', 'higher', (_t, q) => numCell(q?.dividend_yield, pct2)),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers, quotes, group])

  const trailingRows = useMemo<MetricRow[]>(() => {
    return COMPARE_TRAILING_PERIODS.map((p) =>
      buildRow(
        p,
        p,
        'higher',
        (t) => {
          const series = seriesByTicker[t]
          if ((!series || series.length === 0) && historyLoading[t]) return { num: null, text: '', loading: true }
          const v = trailingByTicker[t]?.[p] ?? null
          return v == null ? { num: null, text: '—' } : { num: v, text: formatPercent(v) }
        },
        { colorBySign: true }
      )
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers, trailingByTicker, seriesByTicker, historyLoading])

  // ── Tab availability (show a tab only when at least one asset has its data) ──
  const anyHoldings = tickers.some((t) => (quotes[t]?.top_holdings?.length ?? 0) > 0)
  const anyRisk = tickers.some((t) => {
    const q = quotes[t]
    return [q?.beta, q?.std_dev, q?.sharpe, q?.alpha, q?.dividend_yield, q?.profit_margins].some((v) => v != null)
  })

  const availableTabs = useMemo(() => {
    const t: { id: string; label: string }[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'performance', label: 'Performance' },
    ]
    if (anyHoldings) t.push({ id: 'holdings', label: 'Holdings' })
    if (anyRisk) t.push({ id: 'risk', label: 'Risk & Dividends' })
    return t
  }, [anyHoldings, anyRisk])

  useEffect(() => {
    if (!availableTabs.some((t) => t.id === activeTab)) setActiveTab('overview')
  }, [availableTabs, activeTab])

  const ready = tickers.length >= 2

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        icon={GitCompare}
        accent="signal"
        eyebrow="Análisis · Lado a lado"
        title="Comparar"
        description="Compara ETFs, fondos, acciones o índices lado a lado."
        actions={
          ready ? (
            <button
              type="button"
              aria-pressed={highlight}
              onClick={() => setHighlight((h) => !h)}
              className={pillClass(highlight)}
            >
              Resaltar diferencias
            </button>
          ) : undefined
        }
      />

      <CompareTickerBar
        tickers={tickers}
        names={names}
        onAdd={handleAdd}
        onRemove={remove}
        onReset={reset}
        disabledFor={disabledFor}
      />

      {!ready ? (
        <EmptyState
          icon={GitCompare}
          title="Agrega al menos 2 activos"
          description="Busca un ticker arriba para comenzar. El primero fija el tipo de comparación (ETFs e índices se comparan entre sí; fondos y acciones por separado)."
        />
      ) : (
        <>
          <CompareHero tickers={tickers} names={names} quotes={quotes} />

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="flex-wrap">
              {availableTabs.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="overview" className="mt-4">
              <CompareMetricsTable tickers={tickers} names={names} rows={overviewRows} highlight={highlight} />
            </TabsContent>

            <TabsContent value="performance" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Crecimiento de $10,000</CardTitle>
                  <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} size="sm" aria-label="Rango" />
                </CardHeader>
                <CardContent>
                  <CompareGrowthChart tickers={tickers} seriesByTicker={seriesByTicker} range={range} loading={historyLoading} />
                </CardContent>
              </Card>

              <div className="space-y-2">
                <p className="px-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Retornos acumulados
                </p>
                <CompareMetricsTable tickers={tickers} names={names} rows={trailingRows} highlight={highlight} />
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Retornos por año calendario</CardTitle>
                </CardHeader>
                <CardContent>
                  <CompareAnnualReturns tickers={tickers} annualByTicker={annualByTicker} loading={historyLoading} />
                </CardContent>
              </Card>
            </TabsContent>

            {anyHoldings && (
              <TabsContent value="holdings" className="mt-4">
                <CompareHoldings tickers={tickers} quotes={quotes} />
              </TabsContent>
            )}

            {anyRisk && (
              <TabsContent value="risk" className="mt-4">
                <CompareMetricsTable tickers={tickers} names={names} rows={riskRows} highlight={highlight} />
              </TabsContent>
            )}
          </Tabs>
        </>
      )}
    </div>
  )
}
