# Evolve Dashboard — Claude Code Instructions

## Proyecto
Dashboard financiero multiusuario SaaS. Next.js 16 App Router, Supabase (auth + DB + RLS), Yahoo Finance (precios en tiempo real + fundamentals sin API key).

## Reglas
- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- ALWAYS read a file before editing it
- Keep files under 500 lines
- NEVER commit secrets, credentials, or .env files

## Stack
- **Framework**: Next.js 16.2.5 (Turbopack), React 19, TypeScript
- **Estilos**: Tailwind CSS + shadcn/ui (Radix UI)
- **Tabla**: TanStack Table v8
- **Data fetching**: TanStack Query v5 (`refetchInterval: 5000` para precios)
- **Auth + DB**: Supabase (`@supabase/ssr` para SSR con cookies)
- **Precios**: Yahoo Finance v8 REST (`https://query1.finance.yahoo.com/v8/finance/chart/`) — sin API key
- **Fundamentals**: `yahoo-finance2` v3 (maneja crumb/cookies de Yahoo Finance automáticamente)
- **Históricos**: Yahoo Finance v8 REST — sin API key
- **Temas**: `next-themes`, `defaultTheme: 'dark'`

## Convenciones importantes

### Next.js 16 — middleware
El archivo de protección de rutas se llama `proxy.ts` (NO `middleware.ts`). La función exportada se llama `proxy` (NO `middleware`). Esto es un cambio de Next.js 16.

### Supabase — tipos de cookies
En `lib/supabase/middleware.ts` y `lib/supabase/server.ts` NO usar `CookieMethodsServer['setAll']` porque es opcional y `Parameters<>` falla. Usar el tipo explícito:
```typescript
type CookiesToSet = Array<{ name: string; value: string; options?: Record<string, unknown> }>
```

### Supabase — cliente admin en API routes
El `createClient` de supabase-js NO debe llamarse a nivel de módulo en API routes. Siempre dentro de una función factory llamada dentro del handler:
```typescript
function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
```

### RLS (Row Level Security)
| Tabla | Política |
|---|---|
| `profiles` | Solo el propio usuario (select/insert/update) |
| `watchlists` | Solo el propio usuario (`user_id = auth.uid()`) |
| `watchlist_assets` | Via join con watchlists del usuario |
| `assets_metadata` | SELECT público + INSERT para usuarios autenticados |
| `price_cache` | SELECT público, escritura solo vía service role |

### Flash animation de precios
`useRealtimePrices` compara precio anterior con `useRef`, setea `'up'|'down'` en `flashStates`, se limpia a los 1.5s. Las clases CSS `animate-flash-green` y `animate-flash-red` están definidas en `tailwind.config.ts`.

## Estructura de archivos clave
```
app/
  (auth)/login/page.tsx          # Login + registro dual-mode
  (dashboard)/
    layout.tsx                   # Server component — verifica auth, renderiza DashboardShell
    page.tsx                     # Overview / redirect a primera watchlist
    watchlist/[id]/page.tsx      # Server component — carga watchlist y assets
  api/market/
    quote/route.ts               # Proxy Finnhub + cache en price_cache (TTL 60s)
    history/route.ts             # Yahoo Finance v8 históricos
    search/route.ts              # Búsqueda Finnhub
components/dashboard/
  DashboardShell.tsx             # Sidebar + nav (client)
  WatchlistView.tsx              # Bridge server→client para watchlist
  WatchlistTable.tsx             # TanStack Table con todas las columnas
  WatchlistManager.tsx           # CRUD watchlists en sidebar
  TickerSearch.tsx               # Búsqueda con debounce 300ms
  PriceCell.tsx                  # Celda con flash verde/rojo
  MetricsSelector.tsx            # Toggle columnas (persiste en JSONB)
  AssetDetailModal.tsx           # Modal con gráfico Recharts + peers
hooks/
  useWatchlistAssets.ts          # useWatchlists + useWatchlistAssets
  useRealtimePrices.ts           # Polling 5s + flash states
  usePerformanceMetrics.ts       # Cálculo retornos históricos
  useFxData.ts                   # FX spot rates (1-min) + period returns (5-min) para conversión USD
lib/
  supabase/{client,server,middleware}.ts
  market/{finnhub,history}.ts
  utils/{formatters,performance}.ts
types/index.ts                   # Todos los tipos + METRIC_DEFINITIONS
supabase/schema.sql              # DDL completo — correr en Supabase SQL Editor
proxy.ts                         # Protección de rutas (Next.js 16)
```

## Variables de entorno requeridas
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # Importante: empieza con eyJ (no eeyJ)
FINNHUB_API_KEY=                 # Si es 'your-finnhub-api-key' → modo mock con 10 tickers hardcoded
```

## Comandos
```bash
npm run dev    # Desarrollo con Turbopack
npm run build  # Verificar TypeScript + build
```

## Notas de arquitectura
- El caché de precios vive en Supabase `price_cache` (no en memoria) — serverless-safe
- TTL de precios: 60s. TTL de fundamentals: 24h (`fundamentals_fetched_at` timestamptz en `price_cache`)
- `price_cache` tiene columna `currency text` (migración: `ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS currency text`) — se puebla desde `meta.currency` de Yahoo Finance v8
- **Yahoo Finance v10 requiere auth**: La API v10 de Yahoo necesita crumb + cookies de sesión del navegador. Node.js no puede obtenerlos (Yahoo envía >16KB de Set-Cookie headers → `HPE_HEADER_OVERFLOW`). Por eso se usa `yahoo-finance2` que maneja esto internamente.
- `yahoo-finance2` v3 usa constructor: `const yf = new YahooFinanceLib({ suppressNotices: [...], validation: { logErrors: false } })`. No usar el import default de versiones antiguas.
- `validateResult: false` en `quoteSummary()`: Yahoo devuelve `fundProfile.brokerages` como array de strings (no objetos), lo que rompe la validación del schema. Este flag suprime el error y devuelve los datos de todas formas.
- `serverExternalPackages: ['yahoo-finance2']` en `next.config.ts`: Evita que webpack intente bundlear el paquete (que tiene imports de archivos de test que fallan en build).
- ETFs/fondos usan `beta3Year` (no `beta`), `summaryDetail.yield` (no `dividendYield`), `defaultKeyStatistics.totalAssets` para AUM.
- Stocks usan `summaryDetail.marketCap` (no `defaultKeyStatistics.marketCap` — ese campo no existe en yahoo-finance2 v3 para equities).
- Los históricos de Yahoo Finance usan `User-Agent: Mozilla/5.0` para evitar 403
- Los retornos YTD usan `range=ytd` de Yahoo que calcula el último día hábil del año anterior automáticamente
- Script de diagnóstico: `node scripts/diagnose.mjs <TICKER>` — verifica CAPA 1 (HTTP), CAPA 2 (JSON paths), CAPA 3 (API route)
- **Conversión USD**: `useFxData` obtiene tipos de cambio via `/api/market/quote` (pares como `GBPUSD=X`) y retornos históricos via `/api/market/history`. GBX (peniques) usa `GBPUSD=X` dividido entre 100. Fórmula retornos: `(1 + local%) × (1 + fx_period%) − 1`.
- **Watchlists por defecto** (3): First Trust, Evolve Universe, Pershing Square — sembradas via trigger `on_profile_created_seed_watchlists`. Backfill manual: `SELECT seed_<name>_watchlist(id) FROM profiles`.
- **CT funds tickers**: `0P0000NCAC` (Global Tech), `0P00000R12.L` (Japan), `0P00000R0U.L` (European), `0P0001CZXM.L` (Global Focus), `0P00000XBQ.L` (North American) — tickers internos de Yahoo Finance para fondos sin cotización directa.
