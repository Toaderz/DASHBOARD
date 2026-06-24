'use client'

import { useCallback, useRef, useState } from 'react'
import { SlidersHorizontal, GripVertical } from 'lucide-react'
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

// Canonical rank of a metric within METRIC_DEFINITIONS (chronological/time order).
const canonicalRank = (key: MetricKey) => METRIC_DEFINITIONS.findIndex((d) => d.key === key)

export function MetricsSelector({ selected, onChange }: MetricsSelectorProps) {
  const dragIndexRef = useRef<number | null>(null)
  // Where the dragged item would land: the hovered row + whether it drops above or below it.
  const [dropTarget, setDropTarget] = useState<{ index: number; position: 'before' | 'after' } | null>(null)

  const emit = useCallback((next: MetricKey[]) => onChange(next), [onChange])

  const toggle = useCallback(
    (key: MetricKey, checked: boolean) => {
      if (!checked) {
        emit(selected.filter((k) => k !== key))
        return
      }
      // Insert in canonical (time) order: before the first selected metric that ranks after it.
      const rank = canonicalRank(key)
      const insertAt = selected.findIndex((k) => canonicalRank(k) > rank)
      const next = [...selected]
      if (insertAt === -1) next.push(key)
      else next.splice(insertAt, 0, key)
      emit(next)
    },
    [selected, emit]
  )

  // Selected metrics in their current order
  const selectedDefs = selected
    .map((k) => METRIC_DEFINITIONS.find((d) => d.key === k))
    .filter(Boolean) as typeof METRIC_DEFINITIONS

  // Unselected metrics in METRIC_DEFINITIONS order
  const unselectedDefs = METRIC_DEFINITIONS.filter((d) => !selected.includes(d.key))

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault()
    if (dragIndexRef.current == null || dragIndexRef.current === index) {
      setDropTarget(null)
      return
    }
    // Drop above or below the hovered row based on where the cursor sits within it.
    const rect = e.currentTarget.getBoundingClientRect()
    const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget({ index, position })
  }

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    const from = dragIndexRef.current
    const dt = dropTarget
    dragIndexRef.current = null
    setDropTarget(null)
    if (from == null || dt == null) return

    // Insertion index in the original array, then adjusted for the removal shift.
    let target = dt.position === 'before' ? dt.index : dt.index + 1
    if (from < target) target -= 1
    if (target === from) return

    const next = [...selected]
    const [moved] = next.splice(from, 1)
    next.splice(target, 0, moved)
    emit(next)
  }

  const handleDragEnd = () => {
    dragIndexRef.current = null
    setDropTarget(null)
  }

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
            <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Drag to reorder</p>
            <div className="mb-3 space-y-1">
              {selectedDefs.map((def, i) => (
                <div
                  key={def.key}
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={(e) => handleDrop(e, i)}
                  onDragEnd={handleDragEnd}
                  className={`relative flex items-center gap-2 rounded px-1 py-1 cursor-grab transition-colors hover:bg-ink-elevated ${
                    dropTarget?.index === i
                      ? dropTarget.position === 'before'
                        ? 'before:absolute before:inset-x-1 before:-top-0.5 before:h-0.5 before:rounded-full before:bg-spark'
                        : 'after:absolute after:inset-x-1 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-spark'
                      : ''
                  }`}
                >
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
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
