'use client'

import { RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TickerSearch } from '@/components/dashboard/TickerSearch'
import { AssetMonogram } from '@/components/dashboard/AssetMonogram'
import type { AssetType, SearchResult } from '@/types'

interface CompareTickerBarProps {
  tickers: string[]
  names: Record<string, string>
  onAdd: (ticker: string, name: string, type: AssetType) => void
  onRemove: (ticker: string) => void
  onReset: () => void
  disabledFor?: (result: SearchResult) => string | undefined
}

// Input row: removable chips for the current comparison + a ticker search to add more
// (group-locked via disabledFor) + Reset. Mirrors ETF.com's comparison input area.
export function CompareTickerBar({ tickers, names, onAdd, onRemove, onReset, disabledFor }: CompareTickerBarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-3 shadow-card sm:flex-row sm:items-center">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {tickers.length === 0 && (
          <span className="px-1 text-sm text-muted-foreground">Agrega activos para comparar…</span>
        )}
        {tickers.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-foreground/[0.06] py-1 pl-1.5 pr-1 text-sm"
          >
            <AssetMonogram ticker={t} size="sm" />
            <span className="font-mono font-semibold text-foreground">{t}</span>
            <span className="hidden max-w-[8rem] truncate text-xs text-muted-foreground sm:inline">
              {names[t] ?? ''}
            </span>
            <button
              type="button"
              onClick={() => onRemove(t)}
              aria-label={`Quitar ${t}`}
              className="focus-ring ml-0.5 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="w-full sm:w-64">
          <TickerSearch
            onAdd={async (ticker, name, type) => onAdd(ticker, name, type)}
            existingTickers={tickers}
            disabledFor={disabledFor}
            placeholder="Agregar activo…"
          />
        </div>
        {tickers.length > 0 && (
          <Button variant="ghost-dim" size="sm" onClick={onReset} className="shrink-0">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        )}
      </div>
    </div>
  )
}
