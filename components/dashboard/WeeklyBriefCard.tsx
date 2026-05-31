'use client'

import type { MarketBrief } from '@/types'

interface Props {
  brief: MarketBrief
}

export function WeeklyBriefCard({ brief }: Props) {
  const paragraphs = (brief.context_md ?? '').split('\n\n').filter(Boolean)

  return (
    <div className="rounded-sm border border-border bg-ink-elevated p-5 space-y-4">
      <h2 className="font-editorial text-sm font-semibold tracking-tight text-foreground">
        Resumen de la semana
      </h2>

      <div className="flex flex-wrap gap-4 text-sm">
        <span>🔴 <strong>{brief.strong_signals}</strong> señales fuertes</span>
        <span>🟡 <strong>{brief.moderate_signals}</strong> señales moderadas</span>
        <span>⚪ <strong>{brief.weak_noise}</strong> ruido / baja relevancia</span>
      </div>

      {brief.top_theme && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Tema dominante:</span>{' '}
          {brief.top_theme}
        </p>
      )}

      {brief.key_risk && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Riesgo clave:</span>{' '}
          {brief.key_risk}
        </p>
      )}

      {paragraphs.length > 0 && (
        <div className="border-t border-border pt-3 space-y-2">
          {paragraphs.map((p, i) => (
            <p key={i} className="text-sm text-muted-foreground leading-relaxed">
              {p}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
