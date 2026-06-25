'use client'

import { useCallback, useMemo } from 'react'
import { SlidersHorizontal, ChevronUp, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { METRIC_DEFINITIONS } from '@/types'
import type { MetricKey } from '@/types'

interface MetricsSelectorProps {
  selected: MetricKey[]
  onChange: (metrics: MetricKey[]) => void
}

const VALID_KEYS = new Set<MetricKey>(METRIC_DEFINITIONS.map((d) => d.key))
// Canonical rank of a metric within METRIC_DEFINITIONS (chronological / time order).
const canonicalRank = (key: MetricKey) => METRIC_DEFINITIONS.findIndex((d) => d.key === key)

export function MetricsSelector({ selected, onChange }: MetricsSelectorProps) {
  // Self-heal the incoming list: drop unknown/legacy keys and de-duplicate, preserving
  // order. Garbage entries (left over from earlier buggy reorders) used to desync the
  // visible rows from the underlying array, so reordering moved the "wrong" row.
  // All mutations below operate on `clean`, so the DB array is repaired on first interaction.
  const clean = useMemo(() => {
    const seen = new Set<MetricKey>()
    return selected.filter((k) => {
      if (!VALID_KEYS.has(k) || seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [selected])

  const emit = useCallback((next: MetricKey[]) => onChange(next), [onChange])

  const toggle = useCallback(
    (key: MetricKey, checked: boolean) => {
      if (!checked) {
        emit(clean.filter((k) => k !== key))
        return
      }
      // Insert in canonical (time) order: just before the first selected metric that
      // comes later in time (e.g. 1W lands right after 1D, before 1M), else at the end.
      const rank = canonicalRank(key)
      const idx = clean.findIndex((k) => canonicalRank(k) > rank)
      const insertAt = idx === -1 ? clean.length : idx
      const next = [...clean]
      next.splice(insertAt, 0, key)
      emit(next)
    },
    [clean, emit]
  )

  // Move the metric `key` one position up (dir = -1) or down (dir = +1).
  // Resolves position by KEY against the cleaned array — never by a render index —
  // so the visible row always maps to the right element.
  const move = useCallback(
    (key: MetricKey, dir: -1 | 1) => {
      const i = clean.indexOf(key)
      const target = i + dir
      if (i === -1 || target < 0 || target >= clean.length) return
      const next = [...clean]
      ;[next[i], next[target]] = [next[target], next[i]]
      emit(next)
    },
    [clean, emit]
  )

  // Sort the selected metrics back into canonical chronological order.
  const sortChronological = useCallback(() => {
    emit([...clean].sort((a, b) => canonicalRank(a) - canonicalRank(b)))
  }, [clean, emit])

  // Selected metrics in their current order
  const selectedDefs = clean
    .map((k) => METRIC_DEFINITIONS.find((d) => d.key === k))
    .filter(Boolean) as typeof METRIC_DEFINITIONS

  // Unselected metrics in METRIC_DEFINITIONS order
  const unselectedDefs = METRIC_DEFINITIONS.filter((d) => !clean.includes(d.key))

  const isSorted = clean.every(
    (k, i) => i === 0 || canonicalRank(clean[i - 1]) <= canonicalRank(k)
  )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4" align="end">
        <p className="mb-1 text-sm font-medium text-foreground">Visible Columns</p>
        <div className="overflow-y-auto max-h-80 pr-1">
        {selectedDefs.length > 0 && (
          <>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Reorder</p>
              {!isSorted && (
                <button
                  type="button"
                  onClick={sortChronological}
                  className="focus-ring rounded text-[10px] font-medium text-spark hover:underline"
                >
                  Sort by time
                </button>
              )}
            </div>
            <div className="mb-3 space-y-1">
              {selectedDefs.map((def, i) => (
                <div
                  key={def.key}
                  className="flex items-center gap-2 rounded px-1 py-1 hover:bg-ink-elevated"
                >
                  <div className="flex flex-col shrink-0">
                    <button
                      type="button"
                      aria-label={`Move ${def.label} up`}
                      disabled={i === 0}
                      onClick={() => move(def.key, -1)}
                      className="focus-ring -my-0.5 rounded text-muted-foreground/60 hover:text-foreground disabled:opacity-25 disabled:hover:text-muted-foreground/60"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${def.label} down`}
                      disabled={i === selectedDefs.length - 1}
                      onClick={() => move(def.key, 1)}
                      className="focus-ring -my-0.5 rounded text-muted-foreground/60 hover:text-foreground disabled:opacity-25 disabled:hover:text-muted-foreground/60"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Checkbox
                    id={`metric-${def.key}`}
                    checked
                    onCheckedChange={() => toggle(def.key, false)}
                  />
                  <Label htmlFor={`metric-${def.key}`} className="flex-1 cursor-pointer text-sm">
                    <span className="font-medium">{def.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{def.description}</span>
                  </Label>
                </div>
              ))}
            </div>
          </>
        )}
        {unselectedDefs.length > 0 && (
          <>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Add column</p>
            <div className="space-y-1">
              {unselectedDefs.map((def) => (
                <div key={def.key} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-ink-elevated">
                  <div className="w-3.5 shrink-0" />
                  <Checkbox
                    id={`metric-${def.key}`}
                    checked={false}
                    onCheckedChange={() => toggle(def.key, true)}
                  />
                  <Label htmlFor={`metric-${def.key}`} className="flex-1 cursor-pointer text-sm">
                    <span className="font-medium">{def.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{def.description}</span>
                  </Label>
                </div>
              ))}
            </div>
          </>
        )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
