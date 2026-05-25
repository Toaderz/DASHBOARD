# Evolve Dashboard

Dashboard financiero multiusuario SaaS para monitoreo de portafolios globales en tiempo real.

## Stack

- **Framework**: Next.js 16.2.5 (Turbopack) + React 19 + TypeScript
- **UI**: Tailwind CSS + shadcn/ui + TanStack Table v8
- **Auth + DB**: Supabase (RLS, SSR cookies)
- **Precios**: Yahoo Finance v8 REST (sin API key) — polling 5s
- **Fundamentals**: `yahoo-finance2` v3 (crumb/cookies automáticos)
- **Históricos**: Yahoo Finance v8 REST

## Funcionalidades principales

- Watchlists por usuario con categorías y orden personalizable
- Precios en tiempo real con flash verde/rojo al cambio
- Columnas configurables: precio, retornos (1D/1W/1M/YTD/1Y/3Y/5Y/MAX), mkt cap, P/E, beta, AUM, expense ratio, dividend yield
- **Anualizar retornos** (toggle "Ann.") — CAGR para periodos ≥1Y
- **Convertir a USD** (toggle "USD") — convierte precio, AUM, mkt cap y retornos usando FX en tiempo real
- **Columna CCY** — muestra la moneda nativa de cada activo
- **Filtro inline** — buscador dentro de la lista para filtrar por ticker o nombre sin salir de la watchlist
- **Ordenar por métrica** — click en cualquier cabecera (1D, AUM, P/E, etc.) para ordenar de mayor a menor o viceversa; nulls siempre al fondo; respeta los toggles Ann. y USD
- **Compartir watchlists** — comparte con otro usuario por email; el destinatario ve la lista en su sidebar (solo lectura) con subtexto `de @usuario` identificando al dueño; puede dejar de seguirla con un clic sin afectar al dueño
- Modal de detalle con gráfico histórico (Recharts) y peers curados por activo

## Watchlists por defecto

Todos los usuarios nuevos reciben automáticamente:

| Watchlist | Descripción |
|---|---|
| **First Trust** | ETFs First Trust seleccionados |
| **Evolve Universe** | Benchmarks y fondos globales (US, Small Caps, Tech, Japan, Europa, EM, China) |
| **Pershing Square** | Holdings del portafolio Pershing Square (PSUS, HHH, BN, UBER, FNMA, FMCC, AMZN, UMGNF, GOOG, QSR, HTZ, META, SEG) |

## Setup

### 1. Variables de entorno

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # empieza con eyJ
FINNHUB_API_KEY=             # 'your-finnhub-api-key' activa modo mock
```

### 2. Base de datos

Corre `supabase/schema.sql` completo en el SQL Editor de Supabase. Incluye DDL, RLS, funciones seed, migraciones comentadas y el bloque `-- SHARING` para la tabla `watchlist_shares`.

### 3. Desarrollo

```bash
npm install
npm run dev    # Turbopack dev server
npm run build  # TypeScript check + build
```

## Arquitectura

```
app/api/market/
  quote/     → precios + fundamentals (cache 60s / 24h en price_cache)
  history/   → retornos históricos + FX period returns
  search/    → búsqueda de tickers
app/api/users/
  find/      → busca usuario por email (service role) para compartir watchlists
hooks/
  useFxData.ts             → spot FX rates (1-min) + period returns (5-min)
  useRealtimePrices.ts     → polling 5s + flash states
  usePerformanceMetrics.ts → cálculo retornos históricos
  useWatchlistAssets.ts    → useWatchlists + useWatchlistAssets + useWatchlistShares
```

## Diagnóstico

```bash
node scripts/diagnose.mjs <TICKER>
```

Verifica HTTP (capa 1), paths JSON (capa 2) y API route (capa 3).
