'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'

/**
 * Single source of truth for chart colors. Recharts consumes ONLY this module.
 *
 * Two ways to use:
 *  - Static (auto-adapts to theme via CSS vars): `seriesColor(i)`, `SEMANTIC.gain`, etc.
 *    These return `hsl(var(--token))` strings — fine for Recharts stroke/fill props.
 *  - Resolved (concrete colors, needed for gradient stops / computed use): `useChartTheme()`,
 *    which re-resolves the CSS vars whenever the theme flips (dep on next-themes resolvedTheme).
 *    Falls back to the hex anchors below during SSR / before hydration.
 */

// Hex fallbacks (must mirror the --chart-N HSL vars in globals.css :root / dark).
export const CHART_SERIES_HEX = [
  '#1B4B6C', '#156082', '#2E7DA1', '#3E9DBF',
  '#5BB8D4', '#0F3A57', '#7FA8C9', '#A9D6E5',
] as const

const FALLBACK = {
  series: [...CHART_SERIES_HEX] as string[],
  gain: '#22c55e',
  loss: '#ef4444',
  neutral: '#7b8794',
  grid: '#262b36',
  axis: '#6b7280',
  tooltipBg: '#1b1f29',
  tooltipBorder: '#2b303b',
}

export interface ChartTheme {
  series: string[]
  gain: string
  loss: string
  neutral: string
  grid: string
  axis: string
  tooltipBg: string
  tooltipBorder: string
}

// Static CSS-var strings (auto-adapt to theme; valid for Recharts stroke/fill).
export const CHART_SERIES = Array.from({ length: 8 }, (_, i) => `hsl(var(--chart-${i + 1}))`)
export const SEMANTIC = {
  gain: 'hsl(var(--gain))',
  loss: 'hsl(var(--loss))',
  neutral: 'hsl(var(--neutral-text))',
}
export const CHART_GRID = 'hsl(var(--chart-grid))'
export const CHART_AXIS = 'hsl(var(--chart-axis))'

/** Color for series index `i` (wraps around the 8-hue palette). */
export function seriesColor(i: number): string {
  return CHART_SERIES[((i % 8) + 8) % 8]
}

/** Tooltip contentStyle for Recharts, built from a resolved theme. */
export function chartTooltipStyle(theme: ChartTheme): React.CSSProperties {
  return {
    backgroundColor: theme.tooltipBg,
    border: `1px solid ${theme.tooltipBorder}`,
    borderRadius: 8,
    fontSize: 12,
    fontFamily: 'var(--font-mono), monospace',
    color: 'hsl(var(--foreground))',
    boxShadow: 'var(--shadow-pop)',
  }
}

function readVar(name: string): string | null {
  if (typeof window === 'undefined') return null
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return null
  // CSS var holds an HSL triplet ("204 60% 26%"); wrap into a usable color string.
  return `hsl(${raw})`
}

/**
 * Resolves the chart palette to concrete colors. Re-runs when the theme flips.
 * Use when you need real color values (e.g. <linearGradient> stops). For plain
 * stroke/fill you can use the static `seriesColor`/`SEMANTIC` strings instead.
 */
export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme()
  const [theme, setTheme] = useState<ChartTheme>(FALLBACK)

  useEffect(() => {
    const series = Array.from({ length: 8 }, (_, i) => readVar(`--chart-${i + 1}`) ?? FALLBACK.series[i])
    setTheme({
      series,
      gain: readVar('--gain') ?? FALLBACK.gain,
      loss: readVar('--loss') ?? FALLBACK.loss,
      neutral: readVar('--neutral-text') ?? FALLBACK.neutral,
      grid: readVar('--chart-grid') ?? FALLBACK.grid,
      axis: readVar('--chart-axis') ?? FALLBACK.axis,
      tooltipBg: readVar('--chart-tooltip-bg') ?? FALLBACK.tooltipBg,
      tooltipBorder: readVar('--chart-tooltip-border') ?? FALLBACK.tooltipBorder,
    })
  }, [resolvedTheme])

  return theme
}
