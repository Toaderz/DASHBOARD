'use client'

import { useCallback, useRef } from 'react'
import { SlidersHorizontal } from 'lucide-react'
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

  const toggle = useCallback(
    (key: MetricKey, checked: boolean) => {
      const next = checked ? [...selected, key] : selected.filter((k) => k !== key)

      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => onChange(next), 500)

      onChange(next)
    },
    [selected, onChange]
  )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4" align="end">
        <p className="mb-3 text-sm font-medium text-foreground">Visible Metrics</p>
        <div className="space-y-2">
          {METRIC_DEFINITIONS.map((def) => (
            <div key={def.key} className="flex items-center gap-2">
              <Checkbox
                id={`metric-${def.key}`}
                checked={selected.includes(def.key)}
                onCheckedChange={(checked) => toggle(def.key, !!checked)}
              />
              <Label htmlFor={`metric-${def.key}`} className="flex-1 cursor-pointer text-sm">
                <span className="font-medium">{def.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">{def.description}</span>
              </Label>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
