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

export function MetricsSelector({ selected, onChange }: MetricsSelectorProps) {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragIndexRef = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const emit = useCallback(
    (next: MetricKey[]) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      onChange(next)
      debounceTimer.current = setTimeout(() => onChange(next), 500)
    },
    [onChange]
  )

  const toggle = useCallback(
    (key: MetricKey, checked: boolean) => {
      const next = checked ? [...selected, key] : selected.filter((k) => k !== key)
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

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOver(index)
  }

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    const from = dragIndexRef.current
    if (from == null || from === dropIndex) {
      setDragOver(null)
      return
    }
    const next = [...selected]
    const [moved] = next.splice(from, 1)
    next.splice(dropIndex, 0, moved)
    emit(next)
    dragIndexRef.current = null
    setDragOver(null)
  }

  const handleDragEnd = () => {
    dragIndexRef.current = null
    setDragOver(null)
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
                  className={`flex items-center gap-2 rounded px-1 py-1 cursor-grab transition-colors ${
                    dragOver === i ? 'bg-bone/[0.08] border border-bone/30' : 'hover:bg-ink-elevated'
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
