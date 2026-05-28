# Evolve Dashboard

Dashboard financiero multiusuario SaaS para monitoreo de portafolios globales en tiempo real.

## Stack

- **Framework**: Next.js 16.2.5 — dev con Turbopack, build con Webpack
- **UI**: React 19, TypeScript, Tailwind CSS + shadcn/ui (Radix UI)
- **Tabla**: TanStack Table v8
- **Data fetching**: TanStack Query v5 (polling 5s para precios)
- **Auth + DB**: Supabase (RLS, SSR cookies vía `@supabase/ssr`)
- **Precios**: Yahoo Finance v8 REST (sin API key)
- **Fundamentals**: `yahoo-finance2` v3 (maneja crumb/cookies automáticamente)
- **Históricos**: Yahoo Finance v8 REST
- **Animaciones**: Framer Motion
- **Charts**: Recharts
- **PWA**: Serwist (service worker)

## Funcionalidades

- **Watchlists** por usuario con categorías y orden personalizable
- **Precios en tiempo real** con flash verde/rojo al cambio (polling 5s)
- **Marquee header** con índices y commodities globales (SPY, QQQ, BTC, GLD, etc.)
- **Columnas configurables**: precio, retornos (1D/1W/1M/YTD/1Y/3Y/5Y/10Y/MAX), market cap, P/E, beta, AUM, expense ratio, dividend yield
- **Anualizar retornos** (toggle "Ann.") — CAGR para períodos ≥1Y
- **Convertir a USD** (toggle "USD") — precio, AUM, mkt cap y retornos usando FX en tiempo real
- **Columna CCY** — moneda nativa de cada activo
- **Filtro inline** — busca por ticker o nombre dentro de la watchlist
- **Ordenar por métrica** — click en cualquier cabecera; nulls siempre al fondo; respeta Ann. y USD
- **Compartir watchlists** — por email; el destinatario ve la lista (solo lectura) con `de @usuario`; puede dejar de seguirla
- **Modal de detalle** — gráfico histórico (Recharts) + panel de fundamentals animado + peers curados
- **Top 10 / Bottom 10** — vistas dedicadas de mejores y peores performers por período
- **Tema oscuro** por defecto con toggle dark/light

## Watchlists por defecto

Todos los usuarios nuevos reciben automáticamente (vía trigger Supabase):

| Watchlist | Descripción |
|---|---|
| **First Trust** | ETFs First Trust seleccionados |
| **Evolve Universe** | Benchmarks y fondos globales (US, Small Caps, Tech, Japan, Europa, EM, China) |
| **Pershing Square** | Holdings del portafolio Pershing Square |

## Setup

### 1. Variables de entorno

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # empieza con eyJ
FINNHUB_API_KEY=             # 'your-finnhub-api-key' activa modo mock
```

### 2. Base de datos

Corre `supabase/schema.sql` completo en el SQL Editor de Supabase. Incluye DDL, RLS, triggers de seed y migraciones.

### 3. Desarrollo

```bash
npm install
npm run dev    # Turbopack dev server
npm run build  # TypeScript check + build
```

## Arquitectura

### API Routes

```
app/api/market/
  quote/    → precios + fundamentals (cache 60s/24h en price_cache)
  history/  → retornos históricos + FX period returns
  search/   → búsqueda de tickers
  export/   → export CSV de watchlist
app/api/users/
  find/     → resuelve email → user_id (service role, para compartir)
```

### Hooks

```
useRealtimePrices.ts      → polling 5s + flashStates (up/down 1.5s)
usePerformanceMetrics.ts  → retornos históricos 1D→MAX
useFxData.ts              → spot FX rates (1-min) + period returns (5-min)
useWatchlistAssets.ts     → CRUD watchlists + sharing
useTopPerformers.ts       → rankings top/bottom por período
```

### Componentes clave

```
DashboardShell.tsx     → layout: sidebar, nav, PriceMarquee
WatchlistTable.tsx     → TanStack Table: sort, filter, flash, modal
AssetDetailModal.tsx   → gráfico Recharts + FundamentalsPanel + peers
FundamentalsPanel.tsx  → bento grid con NumberTicker animado
PriceMarquee.tsx       → ticker marquee header (tickers globales fijos)
TopPerformers.tsx      → top 10 por período con FX
BottomPerformers.tsx   → bottom 10 por período con FX
```

## Diagnóstico

```bash
node scripts/diagnose.mjs <TICKER>
```

Verifica HTTP (capa 1), paths JSON de Yahoo Finance (capa 2) y API route interna (capa 3).
