'use client'

import { useMemo } from 'react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { useChartTheme, seriesColor, chartTooltipStyle, chartTooltipLabelStyle } from '@/lib/chart-theme'
import { compareSeriesColor } from './compare-utils'
import { PieChart as PieIcon } from 'lucide-react'
import type { QuoteData } from '@/types'

interface CompareHoldingsProps {
  tickers: string[]
  quotes: Record<string, QuoteData>
}

const OTHERS_COLOR = 'hsl(var(--muted-foreground) / 0.35)'

function HoldingsDonut({ ticker, quote }: { ticker: string; quote?: QuoteData }) {
  const holdings = (quote?.top_holdings ?? []).filter((h) => h.pct != null).slice(0, 10)
  const data = useMemo(() => {
    const items = holdings.map((h) => ({ name: h.symbol || h.name || '—', value: h.pct as number }))
    const top = items.reduce((s, h) => s + h.value, 0)
    const others = Math.max(0, 100 - top)
    if (others > 0.5) items.push({ name: 'Otros', value: others })
    return items
  }, [holdings])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="font-mono">{ticker}</CardTitle>
      </CardHeader>
      <CardContent>
        {holdings.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Sin holdings publicados</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="h-[160px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={42}
                    outerRadius={70}
                    paddingAngle={1}
                    isAnimationActive={false}
                    stroke="none"
                  >
                    {data.map((entry, i) => (
                      <Cell key={entry.name} fill={entry.name === 'Otros' ? OTHERS_COLOR : seriesColor(i)} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={chartTooltipLabelStyle}
                    formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-1">
              {holdings.map((h, i) => (
                <li key={(h.symbol || h.name || i) as string} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: seriesColor(i) }} />
                    <span className="truncate text-foreground">{h.symbol || h.name}</span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                    {(h.pct as number).toFixed(2)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SectorBars({ tickers, quotes }: CompareHoldingsProps) {
  const theme = useChartTheme()
  const { data, hasData } = useMemo(() => {
    const sectorSet = new Set<string>()
    for (const t of tickers) {
      for (const sw of quotes[t]?.sector_weightings ?? []) if (sw.sector) sectorSet.add(sw.sector)
    }
    const sectors = Array.from(sectorSet)
    const rows = sectors.map((sector) => {
      const row: Record<string, number | string | null> = { sector }
      for (const t of tickers) {
        const sw = quotes[t]?.sector_weightings?.find((s) => s.sector === sector)
        row[t] = sw?.weight != null ? sw.weight * 100 : null // weight is decimal (0.0194 = 1.94%)
      }
      return row
    })
    // Sort by combined weight desc for a readable chart.
    rows.sort((a, b) => {
      const sum = (r: typeof a) => tickers.reduce((s, t) => s + (typeof r[t] === 'number' ? (r[t] as number) : 0), 0)
      return sum(b) - sum(a)
    })
    return { data: rows, hasData: sectors.length > 0 }
  }, [tickers, quotes])

  if (!hasData) return null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Exposición por sector</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[360px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 12, bottom: 64, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
              <XAxis
                dataKey="sector"
                stroke={theme.axis}
                tick={{ fontSize: 10 }}
                interval={0}
                angle={-35}
                textAnchor="end"
                height={70}
              />
              <YAxis stroke={theme.axis} tick={{ fontSize: 11 }} width={44} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
              <Tooltip
                contentStyle={chartTooltipStyle}
                labelStyle={chartTooltipLabelStyle}
                cursor={{ fill: theme.grid, opacity: 0.25 }}
                formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {tickers.map((t, i) => (
                <Bar key={t} dataKey={t} fill={compareSeriesColor(i)} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

export function CompareHoldings({ tickers, quotes }: CompareHoldingsProps) {
  const anyHoldings = tickers.some((t) => (quotes[t]?.top_holdings?.length ?? 0) > 0)
  if (!anyHoldings) {
    return (
      <EmptyState
        icon={PieIcon}
        title="Sin datos de holdings"
        description="Yahoo Finance no publica composición para estos activos."
        compact
      />
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tickers.map((t) => (
          <HoldingsDonut key={t} ticker={t} quote={quotes[t]} />
        ))}
      </div>
      <SectorBars tickers={tickers} quotes={quotes} />
    </div>
  )
}
