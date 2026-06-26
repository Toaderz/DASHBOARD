'use client'

// Scene 4 — "Inteligencia de mercado." Signal vs. noise: what's moving the portfolio,
// read qualitatively (no invented figures, per the project's redaction rules). Speaks the
// brand's "signal" language. Scripted, presentational. (No "AI"/"brief" wording.)

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils/cn'

const READS = [
  { theme: 'Tasas', signal: 'Fuerte', strong: true },
  { theme: 'Energía', signal: 'Moderada', strong: false },
  { theme: 'Tecnología', signal: 'Fuerte', strong: true },
]

export function IntelligenceScene() {
  return (
    <Card className="glass space-y-4 p-5 shadow-pop">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-signal opacity-60 animate-ping motion-reduce:hidden" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-signal shadow-glow" />
        </span>
        <span className="text-sm font-semibold text-foreground">Lo que mueve a tu portafolio</span>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Separamos la señal del ruido: los temas que de verdad están moviendo tus activos esta semana, sin titulares de relleno.
      </p>
      <div className="space-y-2">
        {READS.map((r) => (
          <div key={r.theme} className="flex items-center justify-between rounded-pill border border-border/60 bg-card/40 px-3 py-1.5">
            <span className="text-sm text-foreground">{r.theme}</span>
            <span
              className={cn(
                'font-mono text-[11px] font-semibold uppercase tracking-wide',
                r.strong ? 'text-signal' : 'text-muted-foreground',
              )}
            >
              Señal {r.signal}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
