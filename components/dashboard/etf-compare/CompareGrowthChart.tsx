'use client'

import { useMemo } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { useChartTheme, chartTooltipStyle, chartTooltipLabelStyle } from '@/lib/chart-theme'
import { compareSeriesColor } from './compare-utils'
import type { HistoricalDataPoint } from '@/types'

export type GrowthRange = '1Y' | '3Y' | '5Y'

const RANGE_DAYS: Record<GrowthRange, number> = { '1Y': 365, '3Y': 365 * 3, '5Y': 365 * 5 }
const DAY = 24 * 60 * 60 * 1000
const BASE = 10_000

interface CompareGrowthChartProps {
  tickers: string[]
  seriesByTicker: Record<string, HistoricalDataPoint[]>
  range: GrowthRange
  loading?: Record<string, boolean>
}

function fmtTick(date: string): string {
  const d = new Date(date)
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

/**
 * "Growth of $10,000": each asset's series is sliced to the selected window and
 * rebased so its first visible close = $10,000, then merged by date into one
 * multi-line chart. Colors come from the navy→teal CHART_SERIES ramp (data, not chrome).
 */
export function CompareGrowthChart({ tickers, seriesByTicker, range, loading }: CompareGrowthChartProps) {
  const theme = useChartTheme()

  const data = useMemo(() => {
    // Window anchored to the latest available date across all series.
    let globalEnd = 0
    for (const t of tickers) {
      const s = seriesByTicker[t]
      if (s?.length) globalEnd = Math.max(globalEnd, new Date(s[s.length - 1].date).getTime())
    }
    if (!globalEnd) return []
    const cutoff = globalEnd - RANGE_DAYS[range] * DAY

    const byDate = new Map<string, Record<string, number | string>>()
    for (const t of tickers) {
      const s = seriesByTicker[t]
      if (!s?.length) continue
      const visible = s.filter((p) => new Date(p.date).getTime() >= cutoff && p.close)
      if (visible.length < 2) continue
      const base = visible[0].close
      if (!base) continue
      for (const p of visible) {
        const row = byDate.get(p.date) ?? { date: p.date }
        row[t] = (p.close / base) * BASE
        byDate.set(p.date, row)
      }
    }
    return Array.from(byDate.values()).sort(
      (a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime()
    )
  }, [tickers, seriesByTicker, range])

  const allLoading = tickers.length > 0 && tickers.every((t) => loading?.[t])

  if (allLoading) {
    return <div className="h-[340px] w-full animate-pulse rounded-card bg-foreground/[0.04]" />
  }
  if (data.length === 0) {
    return (
      <div className="flex h-[340px] w-full items-center justify-center rounded-card border border-dashed border-border text-sm text-muted-foreground">
        Sin datos de precios suficientes
      </div>
    )
  }

  return (
    <div className="h-[340px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtTick}
            stroke={theme.axis}
            tick={{ fontSize: 11 }}
            minTickGap={40}
          />
          <YAxis
            stroke={theme.axis}
            tick={{ fontSize: 11 }}
            width={56}
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
            domain={['auto', 'auto']}
          />
          <Tooltip
            contentStyle={chartTooltipStyle}
            labelStyle={chartTooltipLabelStyle}
            labelFormatter={(l) => fmtTick(l as string)}
            formatter={(value: number, name: string) => [
              `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
              name,
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {tickers.map((t, i) => (
            <Line
              key={t}
              type="monotone"
              dataKey={t}
              stroke={compareSeriesColor(i)}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
