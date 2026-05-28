'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useMotionValue, useSpring } from 'framer-motion'
import { Info } from 'lucide-react'
import type { QuoteData, AssetType } from '@/types'

// ─── Number Ticker ────────────────────────────────────────────────────────────
// Animates from 0 to `target` using the abbreviated value (not the raw integer)
function NumberTicker({ target, format }: { target: number; format: (v: number) => string }) {
  const motionValue = useMotionValue(0)
  const spring = useSpring(motionValue, { stiffness: 50, damping: 15 })
  const [display, setDisplay] = useState(format(0))

  useEffect(() => { motionValue.set(target) }, [target, motionValue])
  useEffect(() => spring.on('change', (v) => setDisplay(format(v))), [spring, format])

  return <span className="tabular-nums">{display}</span>
}

// ─── Metric Hint (fixed-position tooltip — immune to overflow-y-auto clipping) ─
function MetricHint({ text }: { text: string }) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef<HTMLSpanElement>(null)

  const show = useCallback(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setPos({ top: rect.top - 10, left: rect.left + rect.width / 2 })
    setVisible(true)
  }, [])

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={() => setVisible(false)}
      className="cursor-help inline-flex items-center"
    >
      <Info className="h-3 w-3 text-muted-foreground/40" />
      {visible && (
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}
          className="z-[9999] w-52 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl pointer-events-none"
        >
          {text}
          <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-border" />
        </div>
      )}
    </span>
  )
}

// ─── Stagger wrapper ──────────────────────────────────────────────────────────
function Card({ children, index, className = '' }: { children: React.ReactNode; index: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatAum(n: number): string {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(0) + 'M'
  return '$' + n.toFixed(0)
}

function formatMarketCap(n: number): string {
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T'
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(0) + 'M'
  return '$' + n.toFixed(0)
}

function labelSector(raw: string): string {
  return raw
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()
}

function formatInceptionDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(month) - 1]} ${parseInt(day)}, ${year}`
}

// ─── Base card styles ─────────────────────────────────────────────────────────
const BASE = 'rounded-lg border border-border bg-card p-3 flex flex-col gap-1'
const GLOW = 'rounded-lg border border-border bg-card p-3 flex flex-col gap-1 cursor-default transition-all duration-300 hover:border-purple-500/40 hover:shadow-[0_0_20px_rgba(168,85,247,0.12)] hover:bg-purple-500/[0.03]'
const LABEL = 'text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1'
const VALUE = 'text-lg font-bold tabular-nums leading-tight'
const VALUE_SM = 'text-base font-semibold tabular-nums leading-tight'

// ─── Tooltip texts ────────────────────────────────────────────────────────────
const HINTS = {
  beta: 'Qué tan volátil es vs. el mercado. Beta > 1 = más volátil. Beta < 1 = más estable.',
  alpha: 'Rendimiento extra obtenido vs. el benchmark. Alpha positivo = el gestor añadió valor.',
  sharpe: 'Retorno por unidad de riesgo total. A mayor Sharpe, mejor relación riesgo/retorno.',
  treynor: 'Igual que Sharpe pero ajustado solo por el riesgo de mercado (Beta).',
  pe: 'Cuánto pagas por cada $1 de beneficio. P/E alto = altas expectativas de crecimiento.',
  pb: 'Precio vs. valor contable de los activos. P/B < 1 puede indicar infravaloración.',
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function ProgressBar({ pct, index }: { pct: number; index: number }) {
  return (
    <div className="relative h-1.5 w-full rounded-full bg-muted/50 overflow-hidden">
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full bg-purple-500/70"
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(pct, 100)}%` }}
        transition={{ duration: 0.55, delay: 0.3 + index * 0.05, ease: 'easeOut' }}
      />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
interface FundamentalsPanelProps {
  quote: QuoteData
  assetType: AssetType
}

export function FundamentalsPanel({ quote, assetType }: FundamentalsPanelProps) {
  const isFund = assetType === 'etf' || assetType === 'fund'

  const hasAnyFundData = !!(
    quote.aum || quote.expense_ratio || quote.pe || quote.beta ||
    quote.alpha || quote.sharpe || quote.treynor || quote.dividend_yield ||
    quote.top_holdings?.length || quote.sector_weightings?.length
  )
  const hasAnyStockData = !!(quote.market_cap || quote.pe || quote.beta || quote.profit_margins)

  if (isFund && !hasAnyFundData) return null
  if (!isFund && !hasAnyStockData) return null

  if (isFund) return <FundPanel quote={quote} />
  return <StockPanel quote={quote} />
}

// ─── ETF / Fund panel ─────────────────────────────────────────────────────────
function FundPanel({ quote }: { quote: QuoteData }) {
  const aumTarget = quote.aum ? quote.aum / 1e9 : 0
  const aumFormat = useCallback((v: number) => '$' + v.toFixed(1) + 'B', [])
  const erTarget = quote.expense_ratio ?? 0
  const erFormat = useCallback((v: number) => v.toFixed(2) + '%', [])

  const riskMetrics = [
    { key: 'alpha', label: 'Alpha', hint: HINTS.alpha, value: quote.alpha, sign: true },
    { key: 'beta',  label: 'Beta',  hint: HINTS.beta,  value: quote.beta,  sign: false },
    { key: 'sharpe',  label: 'Sharpe',  hint: HINTS.sharpe,  value: quote.sharpe,  sign: false },
    { key: 'treynor', label: 'Treynor', hint: HINTS.treynor, value: quote.treynor, sign: false },
  ].filter((m) => m.value != null)

  const topHoldings  = quote.top_holdings ?? []
  const sectorWeights = (quote.sector_weightings ?? [])
    .filter((s) => s.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8)

  const maxHoldingPct = topHoldings.reduce((max, h) => Math.max(max, h.pct ?? 0), 0)
  const maxSectorPct  = sectorWeights.reduce((max, s) => Math.max(max, s.weight * 100), 0)

  let cardIdx = 0

  return (
    <div className="space-y-3">
      {/* Row 1: AUM / Expense Ratio / Inception */}
      {(quote.aum || quote.expense_ratio || quote.inception_date) && (
        <div className="grid grid-cols-3 gap-2">
          {quote.aum && (
            <Card index={cardIdx++} className={BASE}>
              <span className={LABEL}>AUM</span>
              <span className={VALUE}>
                <NumberTicker target={aumTarget} format={aumFormat} />
              </span>
            </Card>
          )}
          {quote.expense_ratio && (
            <Card index={cardIdx++} className={BASE}>
              <span className={LABEL}>Expense Ratio</span>
              <span className={VALUE}>
                <NumberTicker target={erTarget} format={erFormat} />
              </span>
            </Card>
          )}
          {quote.inception_date && (
            <Card index={cardIdx++} className={BASE}>
              <span className={LABEL}>Inception</span>
              <span className="text-sm font-semibold leading-tight">
                {formatInceptionDate(quote.inception_date)}
              </span>
            </Card>
          )}
        </div>
      )}

      {/* Row 2: P/E / P/B / Dividend Yield / Avg Mkt Cap */}
      {(quote.pe || quote.price_to_book || quote.dividend_yield || quote.median_market_cap) && (
        <div className="grid grid-cols-4 gap-2">
          {quote.pe && (
            <Card index={cardIdx++} className={BASE}>
              <span className={LABEL}>
                P/E <MetricHint text={HINTS.pe} />
              </span>
              <span className={VALUE_SM}>{quote.pe.toFixed(1)}×</span>
            </Card>
          )}
          {quote.price_to_book && (
            <Card index={cardIdx++} className={BASE}>
              <span className={LABEL}>
                P/B <MetricHint text={HINTS.pb} />
              </span>
              <span className={VALUE_SM}>{quote.price_to_book.toFixed(2)}×</span>
            </Card>
          )}
          {quote.dividend_yield && (
            <Card index={cardIdx++} className={BASE}>
              <span className={LABEL}>Div. Yield</span>
              <span className={VALUE_SM}>{quote.dividend_yield.toFixed(2)}%</span>
            </Card>
          )}
          {quote.median_market_cap && (
            <Card index={cardIdx++} className={BASE}>
              <span className={LABEL}>Avg Mkt Cap</span>
              <span className="text-sm font-semibold leading-tight">
                {formatMarketCap(quote.median_market_cap)}
              </span>
            </Card>
          )}
        </div>
      )}

      {/* Row 3: Risk & Performance — hover glow */}
      {riskMetrics.length > 0 && (
        <div>
          <p className={`${LABEL} px-0.5 pb-1.5`}>Risk &amp; Performance</p>
          <div className="grid grid-cols-4 gap-2">
            {riskMetrics.map((m, i) => (
              <Card key={m.key} index={cardIdx + i} className={GLOW}>
                <span className={LABEL}>
                  {m.label} <MetricHint text={m.hint} />
                </span>
                <span className={`${VALUE_SM} ${
                  m.sign
                    ? (m.value! > 0 ? 'text-green-500' : m.value! < 0 ? 'text-red-500' : '')
                    : ''
                }`}>
                  {m.sign && m.value! > 0 ? '+' : ''}{m.value!.toFixed(2)}
                  {m.key === 'alpha' ? '%' : ''}
                </span>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Top Holdings */}
      {topHoldings.length > 0 && (
        <Card index={cardIdx++} className="rounded-lg border border-border bg-card p-3">
          <p className={`${LABEL} mb-2`}>Top 10 Holdings</p>
          <div className="space-y-2">
            {topHoldings.map((h, i) => (
              <div key={h.symbol ?? i} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <span className="font-mono text-xs font-semibold shrink-0">{h.symbol ?? '—'}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{h.name ?? ''}</span>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {h.pct != null ? h.pct.toFixed(1) + '%' : '—'}
                  </span>
                </div>
                {h.pct != null && maxHoldingPct > 0 && (
                  <ProgressBar pct={(h.pct / maxHoldingPct) * 100} index={i} />
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Sector Allocation */}
      {sectorWeights.length > 0 && (
        <Card index={cardIdx++} className="rounded-lg border border-border bg-card p-3">
          <p className={`${LABEL} mb-2`}>Sector Allocation</p>
          <div className="space-y-2">
            {sectorWeights.map((s, i) => {
              const pct = s.weight * 100
              return (
                <div key={s.sector} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{labelSector(s.sector)}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                  {maxSectorPct > 0 && (
                    <ProgressBar pct={(pct / maxSectorPct) * 100} index={i} />
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Stock panel ──────────────────────────────────────────────────────────────
function StockPanel({ quote }: { quote: QuoteData }) {
  const mcapTarget = quote.market_cap ? quote.market_cap / 1e9 : 0
  const mcapFormat = useCallback((v: number) => {
    if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'T'
    return '$' + v.toFixed(1) + 'B'
  }, [])

  let cardIdx = 0

  return (
    <div className="space-y-3">
      {/* Row 1 */}
      {(quote.market_cap || quote.pe || quote.dividend_yield) && (
        <div className="grid grid-cols-3 gap-2">
          {quote.market_cap && (
            <Card index={cardIdx++} className={BASE}>
              <span className={LABEL}>Market Cap</span>
              <span className={VALUE}>
                <NumberTicker target={mcapTarget} format={mcapFormat} />
              </span>
            </Card>
          )}
          {quote.pe && (
            <Card index={cardIdx++} className={BASE}>
              <span className={LABEL}>P/E <MetricHint text={HINTS.pe} /></span>
              <span className={VALUE_SM}>{quote.pe.toFixed(1)}×</span>
            </Card>
          )}
          {quote.dividend_yield && (
            <Card index={cardIdx++} className={BASE}>
              <span className={LABEL}>Div. Yield</span>
              <span className={VALUE_SM}>{quote.dividend_yield.toFixed(2)}%</span>
            </Card>
          )}
        </div>
      )}
      {/* Row 2 */}
      {(quote.beta || quote.profit_margins || quote.sector) && (
        <div className="grid grid-cols-3 gap-2">
          {quote.beta && (
            <Card index={cardIdx++} className={GLOW}>
              <span className={LABEL}>Beta <MetricHint text={HINTS.beta} /></span>
              <span className={VALUE_SM}>{quote.beta.toFixed(2)}</span>
            </Card>
          )}
          {quote.profit_margins && (
            <Card index={cardIdx++} className={BASE}>
              <span className={LABEL}>Net Margin</span>
              <span className={VALUE_SM}>{quote.profit_margins.toFixed(1)}%</span>
            </Card>
          )}
          {quote.sector && (
            <Card index={cardIdx++} className={BASE}>
              <span className={LABEL}>Sector</span>
              <span className="text-xs font-semibold leading-tight">{quote.sector}</span>
              {quote.industry && (
                <span className="text-[10px] text-muted-foreground truncate">{quote.industry}</span>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
