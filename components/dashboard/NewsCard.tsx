'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { MarketNews } from '@/types'

const signalConfig = {
  STRONG:   { emoji: '🔴', badge: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' },
  MODERATE: { emoji: '🟡', badge: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  WEAK:     { emoji: '⚪', badge: 'bg-gray-50 text-gray-500 dark:bg-gray-900 dark:text-gray-400' },
}

const ratingConfig = {
  A: { label: 'High Conviction', color: 'text-emerald-600 dark:text-emerald-400' },
  B: { label: 'Relevant',        color: 'text-blue-600 dark:text-blue-400' },
  C: { label: 'Low Impact',      color: 'text-gray-500' },
  D: { label: 'Noise',           color: 'text-gray-400' },
}

const actionabilityConfig = {
  MONITOR:     { emoji: '👁', label: 'MONITOR' },
  REVIEW:      { emoji: '⚠️', label: 'REVIEW' },
  CONFIRMS:    { emoji: '✅', label: 'CONFIRMS' },
  CONTRADICTS: { emoji: '❌', label: 'CONTRADICTS' },
}

const JUNK_PATTERNS = [
  /^skip to (navigation|main content|right column)/i,
  /^oops,?\s*(something went wrong)?$/i,
  /^view comments$/i,
  /^terms and privacy policy$/i,
  /^your privacy choices$/i,
  /^more info$/i,
  /^story continues$/i,
  /^advertisement$/i,
  /^share this article$/i,
  /^related articles?$/i,
  /^\[.*\]\(#\)$/,           // empty anchor links
  /^!\[.*\]\(data:image/i,   // base64 images
]

function cleanMarkdown(md: string): string {
  return md
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (!t) return true
      return !JUNK_PATTERNS.some((re) => re.test(t))
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface Props {
  news: MarketNews
  userTickers: string[]
}

export function NewsCard({ news, userTickers }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const signal = signalConfig[news.signal] ?? signalConfig.WEAK
  const rating = ratingConfig[news.rating] ?? ratingConfig.C
  const action = news.actionability ? actionabilityConfig[news.actionability] : null

  const matchedTickers = news.affected_tickers.filter((t) => userTickers.includes(t))
  const isRelevant = matchedTickers.length > 0

  const sb = news.score_breakdown

  return (
    <div className="rounded-sm border border-border bg-ink-elevated flex flex-col overflow-hidden">
      {/* Header row */}
      <div className="flex items-start gap-2 p-4">
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-mono ${signal.badge}`}>
          {signal.emoji} {news.signal}
        </span>
        <span className={`shrink-0 text-[11px] font-mono font-semibold ${rating.color}`}>
          [{news.rating}] {rating.label}
        </span>
        {action && (
          <span className="shrink-0 ml-auto text-[11px] font-mono text-muted-foreground whitespace-nowrap">
            {action.emoji} {action.label}
          </span>
        )}
      </div>

      {/* Title + meta */}
      <div className="px-4 pb-3 space-y-1">
        <p className="text-sm font-medium leading-snug text-foreground">{news.title}</p>
        <p className="text-[11px] text-muted-foreground font-mono">
          {news.source_name}
          {news.published_at && ` · ${new Date(news.published_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`}
          {' · '}Score: {news.score}/30
        </p>
      </div>

      {/* Portfolio relevance badge */}
      {isRelevant && (
        <div className="px-4 pb-3">
          <span className="inline-flex items-center gap-1 rounded-sm bg-electric/10 px-2 py-0.5 text-[11px] text-electric font-mono">
            🎯 Relevante para tu portafolio [{matchedTickers.join(', ')}]
          </span>
        </div>
      )}

      {/* Summary */}
      <div className="px-4 pb-3">
        <p className="text-sm text-muted-foreground leading-relaxed">{news.summary}</p>
      </div>

      {/* Actions */}
      <div className="mt-auto flex items-center gap-2 border-t border-border px-4 py-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? 'Cerrar análisis' : 'Ver análisis'}
        </button>
        <a
          href={news.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          Fuente
        </a>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3 bg-ink-base">
          {/* Score breakdown */}
          <div>
            <p className="text-[11px] font-mono text-muted-foreground mb-1">Score breakdown:</p>
            <p className="text-[11px] font-mono text-muted-foreground">
              Macro {sb.macro} · Surprise {sb.surprise} · Mkt Rel {sb.market_rel} · Forward {sb.forward} · Structural {sb.structural} · Portfolio {sb.portfolio} · Time {sb.time_decay}
            </p>
          </div>

          {/* Insight */}
          <div>
            <p className="text-[11px] font-mono text-muted-foreground mb-1">Análisis:</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{news.insight}</p>
          </div>

          {/* Full article button */}
          {news.full_text_md && (
            <button
              onClick={() => setDialogOpen(true)}
              className="text-xs text-electric hover:underline"
            >
              📄 Artículo completo →
            </button>
          )}
        </div>
      )}

      {/* Full article dialog */}
      {news.full_text_md && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-sm font-medium leading-snug">{news.title}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-y-auto">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{cleanMarkdown(news.full_text_md)}</ReactMarkdown>
              </div>
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
    </div>
  )
}
