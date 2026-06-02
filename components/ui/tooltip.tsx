'use client'

import * as React from 'react'
import { Popover, PopoverAnchor, PopoverContent } from './popover'
import { cn } from '@/lib/utils/cn'

// In-house tooltip built on Radix Popover (no @radix-ui/react-tooltip dep).
// Opens on hover AND keyboard focus; uses PopoverAnchor (not Trigger) so there's
// no click-to-toggle conflict with tooltip semantics.
interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  className?: string
  delay?: number
}

export function Tooltip({ content, children, side = 'top', align = 'center', className, delay = 120 }: TooltipProps) {
  const [open, setOpen] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), delay)
  }
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setOpen(false)
  }
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  if (content == null || content === '') return <>{children}</>

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          className="inline-flex"
          tabIndex={0}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
        >
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(
          'pointer-events-none w-auto max-w-xs rounded-md border-border bg-popover px-2.5 py-1.5 text-xs leading-snug text-popover-foreground shadow-pop',
          className
        )}
      >
        {content}
      </PopoverContent>
    </Popover>
  )
}
