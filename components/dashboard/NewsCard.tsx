'use client'

import { useState, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils/cn'
import type { MarketNews } from '@/types'

// Signal = urgency. Documented V2 exception: red/amber carry meaning; weak → neutral bone.
const signalConfig = {
  STRONG:   { label: 'Señal fuerte',    dot: 'bg-red-500' },
  MODERATE: { label: 'Señal moderada',  dot: 'bg-amber-400' },
  WEAK:     { label: 'Baja relevancia', dot: 'bg-bone-dim' },
}

// Rating — V2: no rainbow. Neutral typographic label only (no emerald/blue/gray spread).
const ratingConfig = {
  A: 'Alta convicción',
  B: 'Relevante',
  C: 'Bajo impacto',
  D: 'Ruido',
}

const actionabilityConfig = {
  MONITOR:     'Monitorear',
  REVIEW:      'Revisar',
  CONFIRMS:    'Confirma tesis',
  CONTRADICTS: 'Contradice tesis',
}

// Reader-friendly renderers for the stored (already-clean) article markdown.
const markdownComponents = {
  p: (props: ComponentPropsWithoutRef<'p'>) => (
    <p {...props} className="my-3.5 text-[15px] leading-7 text-foreground/90" />
  ),
  h1: (props: ComponentPropsWithoutRef<'h1'>) => (
    <h1 {...props} className="mb-2 mt-6 font-editorial text-xl font-bold text-foreground" />
  ),
  h2: (props: ComponentPropsWithoutRef<'h2'>) => (
    <h2 {...props} className="mb-2 mt-6 font-editorial text-lg font-semibold text-foreground" />
  ),
  h3: (props: ComponentPropsWithoutRef<'h3'>) => (
    <h3 {...props} className="mb-2 mt-5 text-base font-semibold text-foreground" />
  ),
  ul: (props: ComponentPropsWithoutRef<'ul'>) => (
    <ul {...props} className="my-3 list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-foreground/90 marker:text-muted-foreground" />
  ),
  ol: (props: ComponentPropsWithoutRef<'ol'>) => (
    <ol {...props} className="my-3 list-decimal space-y-1.5 pl-5 text-[15px] leading-7 text-foreground/90 marker:text-muted-foreground" />
  ),
  li: (props: ComponentPropsWithoutRef<'li'>) => <li {...props} className="pl-1" />,
  blockquote: (props: ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote {...props} className="my-4 border-l-2 border-bone/50 pl-4 italic text-muted-foreground" />
  ),
  strong: (props: ComponentPropsWithoutRef<'strong'>) => (
    <strong {...props} className="font-semibold text-foreground" />
  ),
  hr: () => <hr className="my-6 border-border" />,
  a: (props: ComponentPropsWithoutRef<'a'>) => (
    <a {...props} target="_blank" rel="noopener noreferrer" className="text-foreground underline decoration-bone/40 underline-offset-2 hover:decoration-foreground" />
  ),
  img: (props: ComponentPropsWithoutRef<'img'>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      alt={props.alt ?? ''}
      loading="lazy"
      // Sin Referer: los CDN de noticias (Reuters/CNBC) bloquean el hotlink cross-origin por Referer.
      referrerPolicy="no-referrer"
      // Si la imagen falla igual (token expirado/403), la ocultamos en vez de mostrar ícono roto.
      onError={(e) => { e.currentTarget.style.display = 'none' }}
      className="my-5 max-h-[55vh] w-full rounded-card bg-ink-base object-contain"
    />
  ),
}

interface Props {
  news: MarketNews
  userTickers: string[]
  index?: number
  featured?: boolean
}

export function NewsCard({ news, userTickers, index, featured = false }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const signal = signalConfig[news.signal] ?? signalConfig.WEAK
  const ratingLabel = ratingConfig[news.rating] ?? ratingConfig.C
  const actionLabel = news.actionability ? actionabilityConfig[news.actionability] : null

  const matchedTickers = news.affected_tickers.filter((t) => userTickers.includes(t))
  const isRelevant = matchedTickers.length > 0
  const sb = news.score_breakdown
  const idx = typeof index === 'number' ? String(index + 1).padStart(2, '0') : null
  const dateStr = news.published_at
    ? new Date(news.published_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
    : null

  const signalTag = (
    <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${signal.dot}`} />
      {signal.label}
    </span>
  )

  const byline = (
    <p className="font-mono text-[11px] text-muted-foreground">
      {news.source_name}
      {dateStr && ` · ${dateStr}`}
      {' · '}
      <span className="text-bone-dim">{ratingLabel}</span>
      {' · '}
      <span className="tabular-nums">{news.score}/25</span>
    </p>
  )

  const relevanceBadge = isRelevant && (
    <span className="inline-flex w-fit animate-pulse-ring items-center gap-1 rounded-pill bg-spark/10 px-2 py-0.5 font-mono text-[11px] text-spark">
      🎯 {matchedTickers.join(', ')}
    </span>
  )

  return (
    <Card className={cn('card-lift flex h-full flex-col overflow-hidden', featured && 'border-bone/20')}>
      {featured ? (
        <div className="grid flex-1 sm:grid-cols-[6.5rem_1fr]">
          {/* Index rail */}
          <div className="hidden flex-col justify-between border-r border-border bg-muted/30 p-5 sm:flex">
            {idx && <span className="font-editorial text-5xl font-bold leading-none tabular-nums text-bone-dim">{idx}</span>}
            {signalTag}
          </div>
          {/* Body */}
          <div className="flex flex-col p-6">
            <div className="flex items-center gap-3">
              <p className="eyebrow">Lo más relevante de la semana</p>
              {actionLabel && (
                <span className="ml-auto font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{actionLabel}</span>
              )}
            </div>
            <h3 className="mt-2 font-editorial text-xl font-bold leading-tight text-foreground sm:text-2xl">{news.title}</h3>
            <div className="mt-2">{byline}</div>
            {isRelevant && <div className="mt-3">{relevanceBadge}</div>}
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{news.summary}</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col p-5">
          <div className="flex items-center gap-3">
            {idx && <span className="font-editorial text-sm font-bold tabular-nums text-bone-dim">{idx}</span>}
            {signalTag}
            {actionLabel && (
              <span className="ml-auto font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{actionLabel}</span>
            )}
          </div>
          <h3 className="mt-3 font-editorial text-base font-semibold leading-snug text-foreground">{news.title}</h3>
          <div className="mt-1.5">{byline}</div>
          {isRelevant && <div className="mt-3">{relevanceBadge}</div>}
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{news.summary}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 border-t border-border px-5 py-2.5">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="focus-ring flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? 'Cerrar análisis' : 'Ver análisis'}
        </button>
        <a
          href={news.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          Fuente
        </a>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="space-y-3 border-t border-border bg-ink-base px-5 py-3">
          <div>
            <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Score breakdown</p>
            <p className="font-mono text-[11px] text-muted-foreground">
              Macro {sb.macro} · Surprise {sb.surprise} · Mkt Rel {sb.market_rel} · Forward {sb.forward} · Structural {sb.structural} · Portfolio {sb.portfolio} · Time {sb.time_decay}
            </p>
          </div>
          <div>
            <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Análisis</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{news.insight}</p>
          </div>
          {news.full_text_md && (
            <button
              onClick={() => setDialogOpen(true)}
              className="text-xs text-foreground underline-offset-2 hover:underline"
            >
              📄 Artículo completo →
            </button>
          )}
        </div>
      )}

      {/* Full article dialog */}
      {news.full_text_md && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader className="space-y-1.5">
              <DialogTitle className="font-editorial text-xl font-bold leading-tight text-foreground">{news.title}</DialogTitle>
              <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {news.source_name}
                {news.published_at && ` · ${new Date(news.published_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`}
              </p>
            </DialogHeader>
            <div className="-mr-2 max-h-[68vh] overflow-y-auto border-t border-border pr-2 pt-2">
              <article className="max-w-none">
                <ReactMarkdown components={markdownComponents}>{news.full_text_md}</ReactMarkdown>
              </article>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
              <span>
                {news.source_name}
                {news.published_at && ` · ${new Date(news.published_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`}
              </span>
              <a
                href={news.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Leer en fuente original
              </a>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  )
}
