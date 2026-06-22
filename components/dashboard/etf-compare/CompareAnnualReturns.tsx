'use client'

import { useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { useChartTheme, seriesColor, chartTooltipStyle, chartTooltipLabelStyle } from '@/lib/chart-theme'

const MAX_YEARS = 6

interface CompareAnnualReturnsProps {
  tickers: string[]
  annualByTicker: Record<string, Record<number, number | null>>
  loading?: Record<string, boolean>
}

/**
 * Calendar-year returns as grouped bars (one bar per asset per year). Years derived
 * from each asset's daily series; shows the most recent MAX_YEARS shared window.
 */
export function CompareAnnualReturns({ tickers, annualByTicker, loading }: CompareAnnualReturnsProps) {
  const theme = useChartTheme()

  const { data, hasData } = useMemo(() => {
    const yearSet = new Set<number>()
    for (const t of tickers) {
      for (const y of Object.keys(annualByTicker[t] ?? {})) yearSet.add(Number(y))
    }
    const years = Array.from(yearSet).sort((a, b) => a - b).slice(-MAX_YEARS)
    const rows = years.map((y) => {
      const row: Record<string, number | string | null> = { year: String(y) }
      for (const t of tickers) row[t] = annualByTicker[t]?.[y] ?? null
      return row
    })
    return { data: rows, hasData: years.length > 0 }
  }, [tickers, annualByTicker])

  const allLoading = tickers.length > 0 && tickers.every((t) => loading?.[t])

  if (allLoading) {
    return <div className="h-[300px] w-full animate-pulse rounded-card bg-foreground/[0.04]" />
  }
  if (!hasData) {
    return (
      <div className="flex h-[300px] w-full items-center justify-center rounded-card border border-dashed border-border text-sm text-muted-foreground">
        Sin retornos anuales disponibles
      </div>
    )
  }

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
          <XAxis dataKey="year" stroke={theme.axis} tick={{ fontSize: 11 }} />
          <YAxis
            stroke={theme.axis}
            tick={{ fontSize: 11 }}
            width={48}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          />
          <Tooltip
            contentStyle={chartTooltipStyle}
            labelStyle={chartTooltipLabelStyle}
            cursor={{ fill: theme.grid, opacity: 0.25 }}
            formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {tickers.map((t, i) => (
            <Bar key={t} dataKey={t} fill={seriesColor(i)} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
