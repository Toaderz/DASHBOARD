'use client'

import { useState, useCallback, useRef } from 'react'
import { Search, Plus, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { typeBadgeClass, typeLabel } from '@/lib/asset-style'
import type { SearchResult, AssetType } from '@/types'

interface TickerSearchProps {
  onAdd: (ticker: string, name: string, type: AssetType) => Promise<void>
  existingTickers: string[]
}

export function TickerSearch({ onAdd, existingTickers }: TickerSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); setOpen(false); return }
    setIsSearching(true)
    try {
      const res = await fetch(`/api/market/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setResults(data.results ?? [])
      setOpen(true)
    } finally {
      setIsSearching(false)
    }
  }, [])

  const handleChange = (val: string) => {
    setQuery(val)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => search(val), 300)
  }

  const handleAdd = async (result: SearchResult) => {
    setAdding(result.ticker)
    await onAdd(result.ticker, result.name, result.type)
    setAdding(null)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search ticker or company..."
          className="focus-ring pl-9 pr-9"
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {isSearching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg">
          {results.map((result) => {
            const alreadyAdded = existingTickers.includes(result.ticker)
            return (
              <div
                key={result.ticker}
                className={`flex items-center justify-between px-3 py-2 hover:bg-accent ${!alreadyAdded && adding !== result.ticker ? 'cursor-pointer' : 'cursor-default'}`}
                onClick={() => { if (!alreadyAdded && adding !== result.ticker) handleAdd(result) }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-sm font-semibold">{result.ticker}</span>
                  <span className="truncate text-xs text-muted-foreground">{result.name}</span>
                  <Badge
                    variant="outline"
                    className={`shrink-0 border-0 text-xs ${typeBadgeClass(result.type)}`}
                  >
                    {typeLabel(result.type)}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={alreadyAdded || adding === result.ticker}
                  onClick={(e) => { e.stopPropagation(); handleAdd(result) }}
                  className="ml-2 h-7 w-7 shrink-0 p-0"
                >
                  {adding === result.ticker ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
