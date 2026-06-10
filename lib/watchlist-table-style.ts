// Class helpers for WatchlistTable — extracted so the component stays lean and the
// V2 "warm bone + scarce teal" language lives in one place. Pure strings, no logic.

// Sticky first column on mobile (the ticker identity cell).
const STICKY_LEFT = new Set(['ticker'])

// Columns hidden on mobile to cut horizontal scrolling.
const MOBILE_HIDDEN = new Set([
  '3Y', '5Y', '10Y', 'MAX', 'CY2025', 'CY2024', 'CY2023', 'CY2022', 'CY2021', 'CY2020', 'CY2019',
  'expenseRatio', 'aum', 'beta', 'profitMargins', 'from52wHigh', 'inceptionDate',
  'morningstarCategory', 'globalCategory',
])

// Numeric columns → right-aligned + fixed min-width so live price flashes don't jitter the layout.
const NUMERIC_COLS = new Set([
  'price', '1D', '1W', '1M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX',
  'CY2025', 'CY2024', 'CY2023', 'CY2022', 'CY2021', 'CY2020', 'CY2019',
  'marketCap', 'pe', 'dividendYield', 'from52wHigh', 'expenseRatio', 'aum', 'beta', 'profitMargins',
])

const COL_WIDTH: Record<string, string> = {
  ticker: 'min-w-[8.5rem]',
  price: 'min-w-[7rem]',
}
const NUMERIC_DEFAULT_WIDTH = 'min-w-[4.5rem]'

export function isNumericCol(id: string): boolean {
  return NUMERIC_COLS.has(id)
}

/** Shared <th>/<td> class: sticky, mobile-hidden, numeric right-align + width, else left. */
export function colClass(id: string, base = ''): string {
  const sticky = STICKY_LEFT.has(id) ? 'sticky left-0 z-10 bg-background' : ''
  const hidden = MOBILE_HIDDEN.has(id) ? 'hidden md:table-cell' : ''
  const align = NUMERIC_COLS.has(id) ? 'text-right' : 'text-left'
  const width = COL_WIDTH[id] ?? (NUMERIC_COLS.has(id) ? NUMERIC_DEFAULT_WIDTH : '')
  return [base, sticky, hidden, align, width].filter(Boolean).join(' ')
}

/** Toolbar toggle pill — V2: active = bone fill (near-black text), idle = hairline. */
export function pillClass(active: boolean): string {
  return [
    'rounded-pill border px-2.5 py-1.5 font-mono text-xs tracking-wider uppercase transition-colors',
    active
      ? 'border-foreground bg-foreground text-background'
      : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
  ].join(' ')
}
