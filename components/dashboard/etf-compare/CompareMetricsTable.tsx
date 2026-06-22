'use client'

import { useMemo } from 'react'
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { cn } from '@/lib/utils/cn'
import { percentColor } from '@/lib/utils/formatters'

// One comparison cell: `num` drives highlight/sign-color; `text` is what we render.
export interface MetricCell {
  num: number | null
  text: string
  loading?: boolean
}

export interface MetricRow {
  id: string
  label: string
  hint?: string
  // Which direction "wins" for the Highlight toggle. 'none' for text rows (issuer, category).
  direction: 'higher' | 'lower' | 'none'
  colorBySign?: boolean // returns rows → text-gain / text-loss
  values: Record<string, MetricCell>
}

interface CompareMetricsTableProps {
  tickers: string[]
  names: Record<string, string>
  rows: MetricRow[]
  highlight: boolean
}

const EPS = 1e-9

/**
 * Transposed comparison matrix: rows = metrics, columns = assets. Built on TanStack
 * Table (dynamic per-asset column model) with custom cells. Sticky <thead> (asset
 * identity) + sticky-left metric column so both axes stay visible while scrolling.
 * z-index scale kept low (10/20/30) to never collide with the shell/modals (z-50).
 */
export function CompareMetricsTable({ tickers, names, rows, highlight }: CompareMetricsTableProps) {
  const winnersByRow = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    for (const r of rows) {
      const set = new Set<string>()
      if (r.direction !== 'none') {
        let best: number | null = null
        for (const t of tickers) {
          const n = r.values[t]?.num
          if (n == null) continue
          best = best == null ? n : r.direction === 'higher' ? Math.max(best, n) : Math.min(best, n)
        }
        if (best != null) {
          for (const t of tickers) {
            const n = r.values[t]?.num
            if (n != null && Math.abs(n - best) < EPS) set.add(t)
          }
        }
      }
      map[r.id] = set
    }
    return map
  }, [rows, tickers])

  const columns = useMemo<ColumnDef<MetricRow>[]>(() => {
    const metricCol: ColumnDef<MetricRow> = {
      id: 'metric',
      header: () => (
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Métrica</span>
      ),
      cell: ({ row }) => (
        <span className="font-medium text-foreground" title={row.original.hint}>
          {row.original.label}
        </span>
      ),
    }
    const assetCols: ColumnDef<MetricRow>[] = tickers.map((t) => ({
      id: t,
      header: () => (
        <div className="flex flex-col items-end">
          <span className="font-mono text-sm font-semibold text-foreground">{t}</span>
          <span className="max-w-[8rem] truncate text-[10px] font-normal text-muted-foreground">
            {names[t] ?? ''}
          </span>
        </div>
      ),
      cell: ({ row }) => {
        const r = row.original
        const cell = r.values[t]
        if (!cell || cell.loading) {
          return <span className="inline-block h-3 w-12 animate-pulse rounded bg-foreground/10 align-middle" />
        }
        const isWinner = highlight && winnersByRow[r.id]?.has(t)
        return (
          <span
            className={cn(
              'tabular-nums',
              r.colorBySign && cell.num != null ? percentColor(cell.num) : 'text-foreground',
              isWinner && 'font-semibold'
            )}
          >
            {cell.text}
          </span>
        )
      },
    }))
    return [metricCol, ...assetCols]
  }, [tickers, names, highlight, winnersByRow])

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() })

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-card shadow-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const isMetric = header.column.id === 'metric'
                return (
                  <th
                    key={header.id}
                    className={cn(
                      'sticky top-0 whitespace-nowrap border-b border-border bg-card px-3 py-2.5 align-bottom',
                      isMetric ? 'left-0 z-30 min-w-[9rem] text-left' : 'z-20 min-w-[7rem] text-right'
                    )}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-border/50 last:border-0">
              {row.getVisibleCells().map((cell) => {
                const isMetric = cell.column.id === 'metric'
                const isWinner = highlight && !isMetric && winnersByRow[row.original.id]?.has(cell.column.id)
                return (
                  <td
                    key={cell.id}
                    className={cn(
                      'px-3 py-2.5',
                      isMetric ? 'sticky left-0 z-10 bg-card text-left' : 'text-right',
                      isWinner && 'bg-foreground/[0.06]'
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
