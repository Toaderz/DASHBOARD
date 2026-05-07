# Evolve Dashboard

Financial SaaS dashboard for portfolio monitoring, watchlist management, and peer comparison.

## Stack

- **Framework**: Next.js 15+ (App Router, Turbopack), React 19, TypeScript
- **Styles**: Tailwind CSS + shadcn/ui
- **Table**: TanStack Table v8
- **Auth & DB**: Supabase (RLS, SSR cookies)
- **Prices**: Yahoo Finance v8 REST (no API key required)
- **Charts**: Recharts
- **Themes**: next-themes (dark by default)

## Features

- Multi-user authentication via Supabase
- Multiple watchlists with customizable metric columns
- Real-time price polling every 5 seconds with flash animations
- Historical charts (1M, YTD, 1Y, 3Y, 10Y, MAX)
- Peer comparison table with automatic peer discovery
- Semi-dynamic peer taxonomy — classifies assets from DB metadata when not in the static taxonomy
- Ticker search with debounce (Yahoo Finance search API)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env.local.example` to `.env.local` and fill in the values:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
FINNHUB_API_KEY=
```

> If `FINNHUB_API_KEY` is not set or is `your-finnhub-api-key`, the app runs in mock mode with 10 hardcoded tickers.

### 3. Database

Run `supabase/schema.sql` in the Supabase SQL Editor. This creates all tables, RLS policies, and seed data.

### 4. Run

```bash
npm run dev
```

## Project Structure

```
app/
  (auth)/login/          # Login + register
  (dashboard)/           # Protected routes
    watchlist/[id]/      # Watchlist view
  api/market/            # Proxy routes: quote, history, search
components/dashboard/    # UI components
hooks/                   # useWatchlistAssets, useRealtimePrices, usePerformanceMetrics
lib/
  market/                # Yahoo Finance + peer taxonomy
  supabase/              # Client, server, middleware helpers
  utils/                 # Formatters
types/index.ts           # All shared types
supabase/schema.sql      # Full DB schema
proxy.ts                 # Route protection (Next.js 16)
```

## Notes

- Route protection file is `proxy.ts` (not `middleware.ts`) — Next.js 16 requirement
- Price cache lives in Supabase `price_cache` table (serverless-safe, TTL 60s)
- Peer taxonomy is in `lib/market/peer-taxonomy.ts` — static entries for ~120 instruments, with runtime fallback using DB metadata fields
