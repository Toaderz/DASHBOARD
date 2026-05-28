# Evolve Dashboard — Claude Code Instructions

## Proyecto
Dashboard financiero multiusuario SaaS. Next.js 16 App Router, Supabase (auth + DB + RLS), Yahoo Finance (precios en tiempo real + fundamentals sin API key). Deploy en Vercel y Netlify.

## Reglas
- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- ALWAYS read a file before editing it
- Keep files under 500 lines
- NEVER commit secrets, credentials, or .env files

## Stack completo
- **Framework**: Next.js 16.2.5 — `dev` usa Turbopack, `build` usa Webpack (`next build --webpack`)
- **UI**: React 19, TypeScript, Tailwind CSS + shadcn/ui (Radix UI primitives)
- **Tabla**: TanStack Table v8
- **Data fetching**: TanStack Query v5 (`refetchInterval: 5000` para precios)
- **Auth + DB**: Supabase (`@supabase/ssr` v0.6 para SSR con cookies)
- **Precios**: Yahoo Finance v8 REST (`https://query1.finance.yahoo.com/v8/finance/chart/`) — sin API key
- **Fundamentals**: `yahoo-finance2` v3 (maneja crumb/cookies de Yahoo Finance automáticamente)
- **Históricos**: Yahoo Finance v8 REST — sin API key
- **Animaciones**: Framer Motion (`motion`, `useSpring`, `AnimatePresence`)
- **Charts**: Recharts (en `AssetDetailModal`)
- **PWA**: Serwist (`@serwist/next` v9) — service worker en `app/sw.ts`, deshabilitado en dev
- **Temas**: `next-themes`, `defaultTheme: 'dark'`
- **Fuentes**: Fraunces (editorial/números), Plus Jakarta Sans (UI), JetBrains Mono (mono)
- **Iconos**: Lucide React

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
| `profiles` | Solo el propio usuario (select/insert/update) + `authenticated_read_profiles` (cualquier autenticado puede SELECT para share dialog) |
| `watchlists` | Solo el propio usuario (`user_id = auth.uid()`) + `shared_read_watchlists` (destinatarios de shares pueden SELECT) |
| `watchlist_assets` | Via join con watchlists del usuario + `shared_read_assets` (destinatarios pueden SELECT) |
| `watchlist_shares` | `owner_manage_shares` (dueño gestiona) + `recipient_view_shares` (destinatario puede SELECT) |
| `assets_metadata` | SELECT público + INSERT para usuarios autenticados |
| `price_cache` | SELECT público, escritura solo vía service role |

### Flash animation de precios
`useRealtimePrices` compara precio anterior con `useRef`, setea `'up'|'down'` en `flashStates`, se limpia a los 1.5s. Las clases CSS `animate-flash-green` y `animate-flash-red` están definidas en `tailwind.config.ts`.

### AnimatedPrice vs PriceCell
- `AnimatedPrice` — Framer Motion `AnimatePresence`, desliza el número hacia arriba/abajo al cambiar. Para el modal y vistas destacadas.
- `PriceCell` — celda de tabla TanStack, usa flash CSS directo (más ligero). Para la tabla principal.

### yahoo-finance2 v3
- Constructor: `const yf = new YahooFinanceLib({ suppressNotices: [...], validation: { logErrors: false } })`
- `validateResult: false` en `quoteSummary()`: Yahoo devuelve `fundProfile.brokerages` como array de strings (no objetos), rompiendo la validación del schema.
- ETFs/fondos: `beta3Year` (no `beta`), `summaryDetail.yield` (no `dividendYield`), `defaultKeyStatistics.totalAssets` para AUM.
- Stocks: `summaryDetail.marketCap` (no `defaultKeyStatistics.marketCap` — ese campo no existe en v3 para equities).
- `serverExternalPackages: ['yahoo-finance2']` en `next.config.ts`: evita que webpack bundlee el paquete (tiene imports de test que fallan en build).

## Estructura de archivos clave
```
proxy.ts                           # Protección de rutas (Next.js 16) — NO es middleware.ts
app/
  layout.tsx                       # Root layout — fuentes, ThemeProvider, QueryProvider
  globals.css                      # Variables CSS (ink, electric, gain, loss), base styles
  manifest.ts                      # PWA manifest
  sw.ts                            # Service worker (Serwist)
  (auth)/
    login/page.tsx                 # Login + registro dual-mode
  (dashboard)/
    layout.tsx                     # Server — verifica auth, renderiza DashboardShell
    page.tsx                       # Redirect a primera watchlist del usuario
    top10/page.tsx                 # Vista top 10 performers (wrapper de TopPerformers)
    bottom10/page.tsx              # Vista bottom 10 performers (wrapper de BottomPerformers)
    watchlist/[id]/page.tsx        # Server — carga watchlist + assets por ID
  api/
    market/
      quote/route.ts               # Precios + fundamentals; cache en price_cache (TTL 60s / 24h)
      history/route.ts             # Yahoo Finance v8 históricos + FX period returns
      search/route.ts              # Búsqueda de tickers (Finnhub)
      export/route.ts              # Export de watchlist a CSV
    users/
      find/route.ts                # GET ?email= — resuelve email → user_id (service role)
components/
  providers.tsx                    # QueryClient + ThemeProvider (wrapper raíz)
  dashboard/
    DashboardShell.tsx             # Layout principal: sidebar + nav + PriceMarquee (client)
    WatchlistView.tsx              # Bridge server→client: recibe props del server, renderiza tabla
    WatchlistTable.tsx             # TanStack Table: columnas, filtro inline, sort, modal
    WatchlistManager.tsx           # CRUD watchlists + share dialog en sidebar
    AssetDetailModal.tsx           # Modal: gráfico Recharts + fundamentals + peers curados
    FundamentalsPanel.tsx          # Panel premium bento: métricas animadas con NumberTicker
    PriceCell.tsx                  # Celda tabla con flash CSS verde/rojo
    AnimatedPrice.tsx              # Precio animado con Framer Motion (slide up/down)
    PriceMarquee.tsx               # Ticker marquee header (SPY, QQQ, IWM, GLD, BTC, etc.)
    MetricsSelector.tsx            # Checkbox toggle columnas (persiste en JSONB watchlists)
    TickerSearch.tsx               # Búsqueda con debounce 300ms
    TopPerformers.tsx              # Vista top 10 performers por período
    BottomPerformers.tsx           # Vista bottom 10 performers por período
    ThemeToggle.tsx                # Toggle dark/light mode
  ui/                              # shadcn/ui: badge, button, checkbox, dialog, input, label, popover, skeleton
hooks/
  useWatchlistAssets.ts            # useWatchlists + useWatchlistAssets + useWatchlistShares
  useRealtimePrices.ts             # Polling 5s + flashStates (useRef para prev prices)
  usePerformanceMetrics.ts         # Cálculo retornos históricos (1D→MAX)
  useFxData.ts                     # FX spot rates (1-min) + period returns (5-min)
  useTopPerformers.ts              # useAllWatchlistTickers + rankings top/bottom por período
lib/
  supabase/
    client.ts                      # Browser Supabase client (createBrowserClient)
    server.ts                      # Server Supabase client (cookies async)
    middleware.ts                  # updateSession — refresca tokens en cada request
  market/
    finnhub.ts                     # Finnhub API client (search + quote fallback)
    history.ts                     # Yahoo Finance v8 históricos con User-Agent header
    peer-taxonomy.ts               # STATIC_PEERS map + computeInitialPeers()
  utils/
    cn.ts                          # clsx + tailwind-merge
    formatters.ts                  # formatCurrency, formatPercent, formatMarketCap, etc.
types/index.ts                     # AssetType, MetricKey, Profile, Watchlist, WatchlistAsset,
                                   # QuoteData, HistoricalDataPoint, WatchlistShare,
                                   # FlashState, MetricDefinition, METRIC_DEFINITIONS
supabase/schema.sql                # DDL completo + RLS + triggers + funciones seed
scripts/
  diagnose.mjs                     # node scripts/diagnose.mjs <TICKER> — 3 capas de debug
  inspect-asset.mjs                # Inspección de metadata + peers de un activo
```

## Variables de entorno requeridas
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # empieza con eyJ (no eeyJ)
FINNHUB_API_KEY=                 # 'your-finnhub-api-key' → modo mock con 10 tickers hardcoded
```

## Comandos
```bash
npm run dev    # Turbopack dev server
npm run build  # Webpack build con TypeScript check
node scripts/diagnose.mjs <TICKER>   # Diagnóstico de ticker en 3 capas
```

## Notas de arquitectura
- Caché de precios en Supabase `price_cache` (no en memoria) — serverless-safe
- TTL precios: 60s. TTL fundamentals: 24h (`fundamentals_fetched_at` timestamptz)
- `price_cache.currency` se puebla desde `meta.currency` de Yahoo Finance v8
- **Yahoo Finance v10 requiere auth**: Node.js no puede obtener crumb/cookies (Yahoo envía >16KB headers → `HPE_HEADER_OVERFLOW`). Por eso se usa `yahoo-finance2`.
- Los históricos de Yahoo Finance llevan `User-Agent: Mozilla/5.0` para evitar 403
- Los retornos YTD usan `range=ytd` de Yahoo (calcula último día hábil del año anterior automáticamente)
- **Conversión USD**: `useFxData` obtiene spot rates vía `/api/market/quote` (pares como `GBPUSD=X`) y period returns vía `/api/market/history`. GBX (peniques) usa `GBPUSD=X ÷ 100`. Fórmula retornos: `(1 + local%) × (1 + fx_period%) − 1`
- **Watchlists por defecto** (3): First Trust, Evolve Universe, Pershing Square — sembradas vía trigger `on_profile_created_seed_watchlists`. Backfill manual: `SELECT seed_<name>_watchlist(id) FROM profiles`
- **CT funds tickers**: `0P0000NCAC` (Global Tech), `0P00000R12.L` (Japan), `0P00000R0U.L` (European), `0P0001CZXM.L` (Global Focus), `0P00000XBQ.L` (North American) — tickers internos Yahoo Finance para fondos sin cotización directa
- **Peer taxonomy** (`lib/market/peer-taxonomy.ts`): mapa estático `STATIC_PEERS` curado para todos los activos de las 3 watchlists. `computeInitialPeers()` lo consulta primero; si no hay entrada, cae al scoring algorítmico
- **Filtro inline de watchlist**: input "Filter list…" en toolbar de `WatchlistTable` — filtra por ticker/nombre en tiempo real sin afectar precios ni modal
- **Ordenar por métrica**: columnas numéricas tienen `sortingFn` personalizado que extrae el valor numérico respetando toggles USD/Ann. `numSort` envía nulls al fondo. Columnas `helper.display()` necesitan `sortingFn` explícito; CCY y actions tienen `enableSorting: false`
- **Compartir watchlists**: `WatchlistManager` muestra Share2 (hover). Dialog resuelve email → `user_id` vía `/api/users/find`, inserta en `watchlist_shares`. El destinatario ve la lista con icono `Users` + subtexto `de @username`. Puede dejar de seguir (DELETE donde `shared_with_user_id = currentUserId`). PostgREST devuelve join de `profiles` como array — usar `share.profiles?.[0]?.email`
- **Top/Bottom performers** (`useTopPerformers.ts`): `useAllWatchlistTickers` carga todos los tickers del usuario vía Supabase (join `watchlist_assets` + `assets_metadata`). Luego `/api/market/history` por período para calcular retornos y ordenar
- **FundamentalsPanel**: panel bento premium con `NumberTicker` (Framer Motion spring) para animar métricas. Tooltips de información con posición `fixed` para evitar clipping en contenedores `overflow-y-auto`
- **PriceMarquee**: marquee header con tickers globales fijos (SPY, QQQ, IWM, GLD, TLT, BND, DX-Y.NYB, CL=F, GC=F, BTC-USD) — polling independiente de las watchlists del usuario
