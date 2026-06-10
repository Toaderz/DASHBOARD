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
- **Fuentes**: Space Grotesk (`--font-display`, editorial/headlines/números-héroe; clases `.font-editorial`/`.font-display`/`font-display`), Plus Jakarta Sans (`--font-ui`, UI/body), JetBrains Mono (`--font-mono`, datos tabulares). Cargadas vía `next/font/google` en `app/layout.tsx`.
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
| `user_asset_peers` | Solo el propio usuario (`user_id = auth.uid()`, `for all`) — set de peers curado |
| `returns_cache` | SELECT público, escritura solo vía service role |

### Columnas de schema añadidas (migraciones)
```sql
-- watchlist_assets: distingue holdings del usuario de auto-peers del motor
ALTER TABLE watchlist_assets ADD COLUMN source text NOT NULL DEFAULT 'user'
  CHECK (source IN ('user','auto-peer'));
ALTER TABLE watchlist_assets ADD COLUMN peer_of text;   -- ticker base; NULL si 'user'

-- user_asset_peers: curación no destructiva
ALTER TABLE user_asset_peers ADD COLUMN auto_peers text[] NOT NULL DEFAULT '{}';
ALTER TABLE user_asset_peers ADD COLUMN removed    text[] NOT NULL DEFAULT '{}';
ALTER TABLE user_asset_peers ADD COLUMN pinned     text[] NOT NULL DEFAULT '{}';
ALTER TABLE user_asset_peers ADD COLUMN engine_version int NOT NULL DEFAULT 0;

-- price_cache: país de acciones para scoring
ALTER TABLE price_cache ADD COLUMN country text;

-- profiles: estado de onboarding
ALTER TABLE profiles ADD COLUMN onboarding_seen boolean NOT NULL DEFAULT false;
```
`peers` efectivo = `(auto_peers ∪ pinned) − removed`. Se recalcula y persiste en cada materialización.

### Filtro `source='user'` — CRÍTICO
Los siguientes consumidores DEBEN filtrar `source='user'` para que los auto-peers del motor NO contaminen resultados ni el pipeline de IA:
- `hooks/useTopPerformers.ts` (`useAllWatchlistTickers`) — `.eq('source','user')`
- `lib/ai/asset-enrichment.ts` y `lib/ai/news-pipeline.ts` — `.eq('source','user')`
- RPC `get_top_tickers` en DB — incluye `WHERE source='user'`

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
  globals.css                      # Variables CSS (ink, electric, gain, loss, chart-1..8, brand, shadows, radii)
  manifest.ts                      # PWA manifest
  sw.ts                            # Service worker (Serwist)
  (auth)/
    login/page.tsx                 # Login + registro dual-mode
  (dashboard)/
    layout.tsx                     # Server — verifica auth + onboarding_seen, envuelve en TourProvider
    page.tsx                       # Overview agregado (OverviewDashboard) — ya NO redirige a watchlist
    top10/page.tsx                 # Vista top 10 performers (wrapper de TopPerformers)
    bottom10/page.tsx              # Vista bottom 10 performers (wrapper de BottomPerformers)
    vs-peers/page.tsx              # Vista Beating Peers (wrapper de PeerComparison)
    news/page.tsx                  # Brief de mercado (wrapper de NewsBlock)
    watchlist/[id]/page.tsx        # Server — carga watchlist + assets por ID
  api/
    market/
      quote/route.ts               # Precios + fundamentals; cache en price_cache (TTL 60s / 24h); backfill de assets_metadata con name+type desde Yahoo (ignoreDuplicates → nunca pisa nombres curados); sirve a peers STATIC que no están en watchlist
      history/route.ts             # Yahoo Finance v8 históricos + FX period returns + mode=calYear (año calendario)
      returns/route.ts             # POST batch — retornos multi-periodo (1W/1M/6M/YTD/1Y) + caché returns_cache (TTL 6h); fallback a último-bueno si el fetch fresco vuelve degradado
      search/route.ts              # Búsqueda de tickers (Finnhub)
      export/route.ts              # Export de watchlist a CSV
    peers/
      init/route.ts                # POST — materializa (determinista) el set inicial de peers por usuario/activo
    news/
      current/route.ts             # GET — brief vigente (o último como stale) + market_news (auth)
    cron/
      news-pipeline/route.ts       # POST (Bearer CRON_SECRET) — orquesta el pipeline de noticias
    users/
      find/route.ts                # GET ?email= — resuelve email → user_id (service role)
components/
  providers.tsx                    # QueryClient + ThemeProvider (wrapper raíz)
  onboarding/
    TourProvider.tsx               # Context: running/stepIndex, start/next/prev/skip/finish; auto-start-once (onboarding_seen + localStorage)
    TourSpotlight.tsx              # Overlay con cutout getBoundingClientRect + Card tooltip; Escape/resize/motion
  dashboard/
    DashboardShell.tsx             # Layout principal: sidebar + nav + PriceMarquee (data-tour attrs añadidos)
    OverviewDashboard.tsx          # Dashboard agregado: KPIs, MarketSnapshot, mini-leaderboards, brief teaser
    WatchlistView.tsx              # Bridge server→client: recibe props del server, renderiza tabla
    WatchlistTable.tsx             # TanStack Table: columnas (incl. 6M), filtro inline, sort, modal, toggle auto-peers
    WatchlistManager.tsx           # CRUD watchlists + share dialog en sidebar (data-tour attrs añadidos)
    AssetDetailModal.tsx           # Modal con Tabs: Summary (AreaChart) · Calendar Years (BarChart) · Peers
    FundamentalsPanel.tsx          # Panel premium bento: métricas animadas con NumberTicker (importado)
    NumberTicker.tsx               # Contador animado Framer Motion (extraído de FundamentalsPanel)
    SegmentedControl.tsx           # Selector pill multi-opción (rounded-pill, size sm/md)
    PageHeader.tsx                 # Cabecera de página: título editorial + descripción + icon + actions slot
    EmptyState.tsx                 # Estado vacío: icono, título, descripción, CTA, variante compact
    StatCard.tsx                   # Tarjeta de KPI: label, value, delta, sub, icon, hint (Tooltip)
    PriceCell.tsx                  # Celda tabla con flash CSS verde/rojo
    AnimatedPrice.tsx              # Precio animado con Framer Motion (slide up/down)
    PriceMarquee.tsx               # Ticker marquee header (tickers globales fijos de BENCHMARK_TICKERS)
    MetricsSelector.tsx            # Checkbox toggle columnas (persiste en JSONB watchlists)
    TickerSearch.tsx               # Búsqueda con debounce 300ms; usa typeBadgeClass/typeLabel de asset-style
    TopPerformers.tsx              # Vista top 10 performers — PageHeader + SegmentedControl + Card
    BottomPerformers.tsx           # Vista bottom 10 performers — PageHeader + SegmentedControl + Card
    PeerComparison.tsx             # Vista Beating Peers: PageHeader + toolbar (filtro ≥N/6 + buscador) + lista ordenada
    PeerCard.tsx                   # Tarjeta por activo: won/lost/insufficient + filas por periodo; denominador = peers asignados. Header: fondos (type='fund') muestran solo nombre (sin ISIN/ticker críptico); ETFs y stocks muestran ticker + nombre real (backfilled). Panel expandido (motion): retorno USD del activo + cada peer, delta pp, ✓/✗ 1-a-1, mini-barra de contexto; fondos ocultan columna ticker en filas expandidas (hideTicker=true si type='fund')
    NewsBlock.tsx                  # Brief de mercado: PageHeader + WeeklyBriefCard + grid de NewsCard
    WeeklyBriefCard.tsx            # Resumen semanal: tema/riesgo, conteos de señal, qué vigilar
    NewsCard.tsx                   # Tarjeta de noticia: señal/rating, badge 🎯, análisis, artículo completo
    ThemeToggle.tsx                # Toggle dark/light mode
    PageTransition.tsx             # V2 — cross-fade de ruta dentro de <main> (AnimatePresence keyed por pathname; reduced→passthrough)
    AssetMonogram.tsx              # V2 — chip de monograma bone neutro único (MONO_STYLE; sin hash arcoíris)
    SpotlightCard.tsx              # V2 — Card con .gradient-border + spotlight bone
  ui/
    card.tsx                       # Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
    tabs.tsx                       # Tabs in-house (sin @radix-ui/react-tabs): teclado ArrowLeft/Right/Home/End
    tooltip.tsx                    # Tooltip sobre Radix Popover (sin @radix-ui/react-tooltip); hover+focus
                                   # shadcn/ui: badge, button, checkbox, dialog, input, label, popover, skeleton
hooks/
  useWatchlistAssets.ts            # useWatchlists + useWatchlistAssets (incluye source/peer_of) + useWatchlistShares
  useRealtimePrices.ts             # Polling 5s + flashStates (useRef para prev prices)
  usePerformanceMetrics.ts         # Cálculo retornos históricos (1D→MAX)
  useFxData.ts                     # FX spot rates (1-min) + period returns (5-min)
  useTopPerformers.ts              # useAllWatchlistTickers (.eq source=user) + rankings top/bottom; anualiza con años NOMINALES fijos (NOMINAL_YEARS) → orden estable
  usePeerComparison.ts             # Beating Peers: won/lost/insufficient gate settled; no-USD sin FX → null; PeriodResult.assigned = peers asignados (denominador constante); PeriodResult.peerReturns (ticker→USD por periodo) + AssetComparison.peerNames/peerTypes (query a assets_metadata, no bloquea settled); nombre/tipo de peers vía cadena assets_metadata→quote en vivo→ticker; instrumentToType() mapea Yahoo instrument_type→AssetType
  usePeerSet.ts                    # add→pinned, remove→removed+borra fila; STATIC_PEERS nunca se recomputa
  useCalendarYearReturns.ts        # Retornos por año calendario (CY2019..actual); mode=calYear, staleTime 6h
  useNewsBrief.ts                  # GET /api/news/current — brief vigente + market_news
lib/
  ai/
    news-pipeline.ts               # Pipeline de noticias: searchNews→rankCandidates→selectTop7→extractContent→analyzeAndSynthesize→selectFinalArticles
    asset-enrichment.ts            # Relevancia determinista: enrichAssetProfiles (Fase A) + matchAffectedSymbols (Fase B)
    article-clean.ts               # Limpieza determinista del full_text_md
    llm.ts                         # callLLM provider-agnostic (cadena Gemini→Groq→Cerebras) + extractJson robusto
    source-authority.ts            # Mapa dominio→autoridad (0..1) para pre-ranking determinista
  supabase/
    client.ts                      # Browser Supabase client (createBrowserClient)
    server.ts                      # Server Supabase client (cookies async)
    middleware.ts                  # updateSession — refresca tokens en cada request
  market/
    finnhub.ts                     # Finnhub API client (search + quote fallback + campo country para acciones)
    history.ts                     # Yahoo Finance v8 históricos + calculateReturn + calculateMultiReturns; fetchHistoricalData reintenta 429/5xx/cuerpo vacío (3 intentos, backoff)
    peer-taxonomy.ts               # STATIC_PEERS + computeInitialPeers() + scoring Morningstar + tie-breaker estable
    morningstar-categories.ts      # MS_GLOBAL_CATEGORY + MS→clasificación; compartido finnhub/peer-taxonomy
    benchmarks.ts                  # BENCHMARK_TICKERS + BENCHMARK_LABELS (marquee y Overview)
  chart-theme.ts                   # useChartTheme() reactivo a resolvedTheme; CHART_SERIES (navy→teal), SEMANTIC, chartTooltipStyle (V2: FALLBACK neutrales warm)
  asset-style.ts                   # TYPE_BADGE (mapa por AssetType), typeBadgeClass(), typeLabel() — fuente única de badges (V2: stock/etf/fund → bone neutro; index/crypto mantienen ámbar/naranja)
  motion-tokens.ts                 # V2 — constantes PURAS (sin 'use client'): EASE_OUT, DUR, SPRING_*, STAGGER, variants fadeUp/staggerContainer, assetLayoutId(t), morphTransition. Importable desde Server Components
  motion-client.ts                 # V2 — 'use client': usePulseOnChange(value) + <ValuePulse> (pulso one-shot al cambiar precio live; reduced→estático)
  watchlist-table-style.ts         # V2 — helpers de estilo de la tabla: colClass(), pillClass(), NUMERIC_COLS, MOBILE_HIDDEN, min-widths anti-jitter (extraídos para no crecer WatchlistTable.tsx)
  utils/
    cn.ts                          # clsx + tailwind-merge
    formatters.ts                  # formatCurrency, formatPercent, formatMarketCap; percentColor() → text-gain/text-loss
types/index.ts                     # AssetType, MetricKey, Profile (+ onboarding_seen), Watchlist, WatchlistAsset (+ source/peer_of),
                                   # QuoteData (+ country), HistoricalDataPoint, WatchlistShare,
                                   # FlashState, MetricDefinition, METRIC_DEFINITIONS
supabase/schema.sql                # DDL completo + RLS + triggers + funciones seed + migraciones Fase 1-2
scripts/
  diagnose.mjs                     # node scripts/diagnose.mjs <TICKER> — 3 capas de debug
  inspect-asset.mjs                # Inspección de metadata + peers de un activo
  refresh-news.mjs                 # Expira el brief vigente + dispara el pipeline (default localhost:3000)
  check-llm.mjs                    # Verifica conectividad de la cadena LLM (Gemini/Groq/Cerebras)
```

## Variables de entorno requeridas
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # empieza con eyJ (no eeyJ)
FINNHUB_API_KEY=                 # 'your-finnhub-api-key' → modo mock con 10 tickers hardcoded
TAVILY_API_KEY=                  # Tavily search API — pipeline de noticias
FIRECRAWL_API_KEY=               # Firecrawl — extracción de artículos completos (bypass paywalls)
FIRECRAWL_API_KEY_2=             # Respaldo Firecrawl: si la primaria se queda sin créditos, extractContent salta aquí
CRON_SECRET=                     # Header Authorization para el cron de Vercel (/api/cron/news-pipeline)
# ── Cadena LLM (lib/ai/llm.ts) — endpoints OpenAI-compatibles con fallback automático ──
# callLLM recorre NEWS_LLM_CHAIN en orden; un proveedor SIN api key se salta solo.
# Modelos DISTINTOS para 'analysis' vs 'selection' por proveedor (no compiten por TPM).
NEWS_LLM_CHAIN=gemini,groq,cerebras   # orden de fallback (default si no se define)
GEMINI_API_KEY=                  # Principal: Gemini 2.5 Flash (Google AI Studio, free, 1M ctx) — aistudio.google.com
# GEMINI_ANALYSIS_MODEL=gemini-2.5-flash | GEMINI_SELECTION_MODEL=gemini-2.5-flash-lite (defaults)
OLLAMA_API_URL=https://api.groq.com/openai  # Fallback 1: Groq (OpenAI-compatible). Ollama local: http://localhost:11434
OLLAMA_API_KEY=                  # Groq: console.groq.com → API Keys. Ollama local: dejar vacío
OLLAMA_MODEL=llama-3.3-70b-versatile        # modelo de SELECCIÓN/enriquecimiento (Groq)
NEWS_ANALYSIS_MODEL=openai/gpt-oss-120b     # modelo de ANÁLISIS (Groq)
CEREBRAS_API_KEY=                # Fallback 2: Cerebras (free, ~1M tokens/día) — cloud.cerebras.ai
```

## Comandos
```bash
npm run dev    # Turbopack dev server
npm run build  # Webpack build con TypeScript check
node scripts/diagnose.mjs <TICKER>   # Diagnóstico de ticker en 3 capas
node scripts/refresh-news.mjs        # Regenera el brief AHORA (expira el vigente + dispara el pipeline)
                                     # ⚠️ ejecuta el código del server destino (default localhost:3000 → necesita npm run dev).
                                     #    Escribe en Supabase (DB compartida), así que el brief se ve en local y prod.
                                     #    Para prod: node scripts/refresh-news.mjs https://TU-APP.vercel.app (requiere deploy ya hecho)
node scripts/check-llm.mjs           # Verifica que la cadena LLM responde (Gemini/Groq/Cerebras)
```

## Notas de arquitectura

### Sistema de diseño (Fase 3 → identidad V2 "warm bone + rare teal spark")
- **Paleta de charts**: `CHART_SERIES` (8 tonos navy→teal→sky, `--chart-1..8`). Consumir siempre vía `useChartTheme()` (`lib/chart-theme.ts`) — resuelve CSS vars a hex/hsl concretos para Recharts; es reactivo a `resolvedTheme`. NUNCA hardcodear colores en charts. Las **series `--chart-1..8` son dato → NO se tocan**; V2 solo calentó los neutrales que las rodean (grid/axis/tooltip + `FALLBACK`).
- **Semánticos**: `text-gain`/`text-loss` (no `text-green-500`/`text-red-500`). `percentColor()` en `formatters.ts` ya los emite.
- **Badges de tipo de activo**: siempre vía `typeBadgeClass(type)` / `typeLabel(type)` de `lib/asset-style.ts`. **V2 (postura estricta "color escaso = caro")**: `stock`/`etf`/`fund` → **bone neutro** (`bg-foreground/10 text-foreground`), diferenciados por el TEXTO (`typeLabel()`), NO por color — una watchlist con 5 ETFs no debe pintar 5 chips de color. `index`/`crypto` mantienen su ámbar/naranja (son raros).
- **Primitivos reutilizables**: `Card` (rounded-card + shadow-card), `Tabs` (in-house, sin nueva dep), `Tooltip` (sobre Radix Popover, sin nueva dep). Usar en toda vista nueva.
- **`no purple` invariant**: `purple-*`/`a855f7`/`168,85,247` no deben existir en componentes (excepto badge editorial de riesgo Alta en `WeeklyBriefCard` que es rojo, no purple). Verificar con grep.
- **AreaChart en AssetDetailModal**: stroke/gradients → `chartTheme.gain/loss`; grid/axes → `chartTheme.grid/axis`; tooltip → `chartTooltipStyle(chartTheme)`. Se actualiza automáticamente al cambiar tema.
- **Tailwind tokens nuevos**: `rounded-card`, `rounded-pill`, `shadow-card`, `shadow-pop`, `shadow-glow`, `colors.brand.navy/teal`, `colors.chart.1..8`, **`colors.bone {DEFAULT,dim,bright}`** y **`colors.spark` (alias de `hsl(var(--electric))`)**. Definidos en `tailwind.config.ts`.
- **`.focus-ring`**: usar en todos los `<button>`/`<input>` crudos (no shadcn) para a11y.

#### Identidad V2 — "warm bone + rare teal spark"
- **Mantra: "el color escaso = caro".** El cromo (bordes, hover, activos, focus, selección, spotlight, monograma, toggles, badges de tipo, links de noticias) es **off-white cálido neutro = `--bone`**, NO color. El color es escaso y con significado.
- **Teal spark (`--electric` → `175 62% 45%`, alias `spark`/`--bone`-vecino) reservado a SOLO 4 puntos de alta señal**: (1) botón CTA `default`, (2) badge 🎯 de `NewsCard`, (3) pulso "● Live"/Activity de mercado, (4) barra `border-l-2 border-spark` del **nav activo** en `DashboardShell`. Fuera de esos 4 + `gain`/`loss`, NADA es teal. Verificar con grep `electric`/`spark` en `components/`.
- **Dark = warm near-black** (hue ~40°, sat 3-6%), por capas/elevación — NO el slate-azul anterior. **Light = "papel cálido / daylight terminal"**, diseñado aparte (papel ~`#F4F1EA`, cards levantadas por sombra suave, hairlines cálidos, `--primary/electric` teal oscurecido AA). Ambos temas de primera clase. Tokens en `app/globals.css` (`:root` dark + `.light`).
- **`--bone`** `40 30% 90%` (+`--bone-dim`, `--bone-bright`); `--ring` → bone. Sombras warm (hue 40°). En light el cromo bone invierte a warm-charcoal.
- **Monograma**: chip bone único (`AssetMonogram.tsx`, `MONO_STYLE`) — se eliminó el hash arcoíris por ticker.
- **Layout Overview** = panel de instrumento (grilla estricta alineada, banda héroe + paneles iguales), NO bento decorativo.

#### Sistema de movimiento V2 (Framer Motion, sin deps nuevas)
- **`lib/motion-tokens.ts` (PURO, sin `'use client'`)**: `EASE_OUT [.22,1,.36,1]`, `DUR{fast .18,base .28,slow .5}`, `SPRING_SOFT/SNAP`, `TICKER_SPRING`, `STAGGER/STAGGER_FAST`, variants `fadeUp`/`staggerContainer`, `assetLayoutId(t)=>`asset-${t}``, `morphTransition`. **Debe quedar puro** para importarse desde Server Components (marcarlo `'use client'` rompería el build de App Router).
- **`lib/motion-client.ts` (`'use client'`)**: `usePulseOnChange(value)` + `<ValuePulse>` — pulso one-shot (scale + ring `gain/loss/electric`) cuando un precio live cambia; `useReducedMotion` → estático. Construido con `createElement` (para que el archivo `.ts` sea válido).
- **Las dos apuestas de motion**: (1) **shared-element fila→modal** — la fila de `WatchlistTable` "crece" al `AssetDetailModal` vía `layoutId={assetLayoutId(ticker)}` + `<LayoutGroup>` a través del portal Radix (Plan A confirmado en uso; Plan B ghost-FLIP en reserva si glitchea). (2) **"el tablero late con el mercado"** — `<ValuePulse>` vive donde HAY dato live a 5s (`useRealtimePrices`): precios de la tabla, benchmarks de `MarketSnapshot`, precio del modal. El héroe del Overview pulsa solo en período `1D` o al cambiar ranking (su dato no es live a 5s).
- **`NumberTicker.tsx`**: count-up spring (`TICKER_SPRING`) + `useReducedMotion` (valor final instantáneo) + `startOnView` (`useInView`).
- **Transición de página**: `components/dashboard/PageTransition.tsx` dentro del `<main>` de `DashboardShell` (NO toca el server `layout.tsx`); `AnimatePresence` keyed por pathname, opacity+rise, `DUR.fast`.
- **Reveals**: listas (`PeerComparison`/`PeerCard`, `NewsBlock`) usan `staggerContainer`+`fadeUp` con `whileInView`; barras divergentes de `PeerCard` animan width 0→target. Todo gateado por `useReducedMotion`.
- **Intocable**: el heartbeat realtime `PriceCell`/`AnimatedPrice` (flash CSS verde/rojo) NO se tocó; ValuePulse es una capa aparte.

### Peers deterministas (Fase 1-2)
- Caché de precios en Supabase `price_cache` (no en memoria) — serverless-safe
- TTL precios: 60s. TTL fundamentals: 24h (`fundamentals_fetched_at` timestamptz)
- `price_cache.currency` se puebla desde `meta.currency` de Yahoo Finance v8
- **Yahoo Finance v10 requiere auth**: Node.js no puede obtener crumb/cookies (Yahoo envía >16KB headers → `HPE_HEADER_OVERFLOW`). Por eso se usa `yahoo-finance2`.
- Los históricos de Yahoo Finance llevan `User-Agent: Mozilla/5.0` para evitar 403
- Los retornos YTD usan `range=ytd` de Yahoo (calcula último día hábil del año anterior automáticamente)
- **Conversión USD**: `useFxData` obtiene spot rates vía `/api/market/quote` (pares como `GBPUSD=X`) y period returns vía `/api/market/history`. GBX (peniques) usa `GBPUSD=X ÷ 100`. Fórmula retornos: `(1 + local%) × (1 + fx_period%) − 1`
- **Watchlists por defecto** (3): First Trust, Evolve Universe, Pershing Square — sembradas vía trigger `on_profile_created_seed_watchlists`. Backfill manual: `SELECT seed_<name>_watchlist(id) FROM profiles`
- **CT funds tickers**: `0P0000NCAC` (Global Tech), `0P00000R12.L` (Japan), `0P00000R0U.L` (European), `0P0001CZXM.L` (Global Focus), `0P00000XBQ.L` (North American) — tickers internos Yahoo Finance para fondos sin cotización directa
- **Peer taxonomy** (`lib/market/peer-taxonomy.ts`): mapa estático `STATIC_PEERS` curado para todos los activos de las 3 watchlists. `computeInitialPeers(selectedAsset, allAssets, { categories })` lo consulta primero (override exacto); si no hay entrada, cae al scoring algorítmico (`scorePeerSimilarity`) sobre el catálogo `TAXONOMY`. El scoring suma un **boost por categoría Morningstar** (misma `morningstarCategory` +25, misma `globalCategory` +12) cuando ambos lados la conocen; `classifyFromMetadata` usa la categoría Morningstar como señal primaria. El mapa `MS_CATEGORY_TO_CLASSIFICATION` (en `peer-taxonomy.ts`) traduce categoría→strategy/universe/etc. Las `categories` (ticker→{morningstar,global}) se inyectan desde `price_cache`. Tie-breaker estable en sort final: `b.score - a.score || (a.ticker < b.ticker ? -1 : 1)` — mismo `price_cache` → mismo set siempre. Constantes `MIN_PEER_SCORE=60`, `MAX_AUTO_PEERS=8`. **NUNCA** recomputa ni sobreescribe entradas `STATIC_PEERS`.
- **Filtro inline de watchlist**: input "Filter list…" en toolbar de `WatchlistTable` — filtra por ticker/nombre en tiempo real sin afectar precios ni modal
- **Ordenar por métrica**: columnas numéricas tienen `sortingFn` personalizado que extrae el valor numérico respetando toggles USD/Ann. `numSort` envía nulls al fondo. Columnas `helper.display()` necesitan `sortingFn` explícito; CCY y actions tienen `enableSorting: false`
- **Compartir watchlists**: `WatchlistManager` muestra Share2 (hover). Dialog resuelve email → `user_id` vía `/api/users/find`, inserta en `watchlist_shares`. El destinatario ve la lista con icono `Users` + subtexto `de @username`. Puede dejar de seguir (DELETE donde `shared_with_user_id = currentUserId`). PostgREST devuelve join de `profiles` como array — usar `share.profiles?.[0]?.email`
- **Top/Bottom performers** (`useTopPerformers.ts`): `useAllWatchlistTickers` carga todos los tickers del usuario vía Supabase (join `watchlist_assets` + `assets_metadata`). Luego `/api/market/history` por período para calcular retornos y ordenar. **Anualización (toggle "Ann.") con años NOMINALES fijos** (`NOMINAL_YEARS = { '1Y':1, '3Y':3, '5Y':5, '10Y':10 }`, idénticos para todos los activos): el CAGR `(1+R)^(1/años)−1` es monótono en R con `años` constante, así el orden del ranking con Ann. = orden sin Ann. para esos períodos. ⚠️ Antes se usaba `entry.years` (duración real del histórico por-activo de `calculateReturn`), lo que daba exponentes distintos entre activos y rompía la monotonía del orden. `MAX` conserva los años reales por-activo (no tiene período nominal). Sub-anuales (1D/1W/1M/6M/YTD) no se anualizan.
- **Beating Peers** (`/vs-peers`, `usePeerComparison.ts` + `PeerComparison`/`PeerCard`): por cada activo del usuario muestra en cuántas de **6 métricas** (1D/1W/1M/6M/YTD/1Y) le gana a sus peers. Un periodo se cuenta como **ganado si supera al ≥75%** de los peers **con dato** (`beaten/evaluated ≥ 0.75`; empate NO cuenta como vencido). **Denominador estable**: `PeriodResult.assigned = peers.length` (total de peers asignados, **constante entre los 6 períodos**); `PeerCard` muestra "ganó a {beaten}/{assigned}" con el mismo Y en todos los períodos. Los peers **sin dato** ese período (incl. no-USD sin FX) caen en `evaluated` solo si tienen dato comparable — NO reducen el denominador y NO penalizan el veredicto won/lost (se decide solo sobre `evaluated`). 1D viene de quotes en vivo; el resto de `/api/market/returns` (POST batch, caché `returns_cache` 6h, `calculateMultiReturns` = 1 serie 1Y → 5 periodos). **Resiliencia de red (paridad con watchlist)**: un periodo mostraba "— sin dato" solo cuando el fetch en vivo de un ticker fallaba transitoriamente (serie 1Y vacía → todo null) y, como los fallos NO se cachean, un ticker sin fila quedaba en blanco en cada carga. Dos capas lo corrigen: (1) `fetchHistoricalData` **reintenta** fallos transitorios (429/5xx/cuerpo vacío, 3 intentos con backoff) — primitivo compartido con el watchlist, endurece la raíz; (2) `returns/route.ts` hace **fallback a último-bueno** — si un fetch fresco vuelve degradado (1Y null) pero existe fila cacheada sana (aun expirada), sirve ese valor en vez de `null` (la caché es un almacén de último-dato-bueno; solo un ticker SIN dato previo muestra el resultado degradado). Todo se normaliza a **USD** con `useFxData` (misma fórmula que Top performers). Se **deduplica la unión** activos∪peers (cada ticker se pide una sola vez). El set de peers por activo se materializa de forma **determinista** en `/api/peers/init` (categorías SIEMPRE desde `price_cache`, no del caller) y se persiste en `user_asset_peers`; el modal y la página comparten ese set (curación con `usePeerSet`). Estado por periodo: `'won'|'lost'|'insufficient'` — se evalúa solo cuando todo está `settled` (tickers/peers/returns/prices/FX cargados); activos no-USD sin FX → `null` (nunca compara retorno local como si fuera USD). `PeerCard` renderiza "—" para `insufficient`. **Panel expandido** (`PeerCard`, animado con Framer Motion `height 0→auto`): al abrir un período muestra la fila del activo (destacada, fondo `brand-teal/10`) y una fila por peer ordenada por retorno desc (sin-dato al fondo), cada una con su **retorno USD** (`PeriodResult.peerReturns[ticker]`, ya calculado en el loop won/lost — solo se **expone**, no cambia la lógica), el **delta pp vs el activo** (`assetReturn − peerReturn`, oculto en mobile vía `hidden sm:block`), un icono **✓/✗** de comparación **1-a-1 estricta** (`assetReturn > peerReturn`; ⚠️ distinto del veredicto del período que usa el umbral ≥0.75 — un período puede estar `lost` aunque gane a algún peer suelto) y una **mini-barra de contexto CSS** proporcional al rango `[min,max]` del grupo (`bg-brand-teal` activo · `bg-chart-1` peer vencido · `bg-muted` peer ganador, mín. 4px). Nombres de peers vía `AssetComparison.peerNames` (cadena: `assets_metadata` → quote en vivo → ticker). `AssetComparison.peerTypes` expone el `AssetType` de cada peer (de `assets_metadata`; fallback a `instrumentToType(prices[].instrument_type)` para peers que no están en watchlist). **Display por tipo en `PeerCard`**: fondos (`type='fund'`) muestran solo `name` en el header y en filas expandidas (`hideTicker=true`) — el ISIN/ticker críptico queda oculto; ETFs y stocks muestran `ticker` + nombre real (backfilled desde Yahoo Finance en `quote/route.ts` con `ignoreDuplicates`). `instrumentToType()` está implementada tanto en `usePeerComparison.ts` (para el hook) como en `quote/route.ts` (para el backfill de `assets_metadata`). **Toolbar** (`PeerComparison`): `SegmentedControl` de relevancia ≥N/6 (`minWon`, default 4/6 = gana >50% de los períodos) + buscador por ticker/nombre (`filterQuery`), combinados en AND sobre `metricsWon`. ⚠️ Checkpoint conocido: la ventana del retorno del activo (por-fecha) y la del FX period return (`range=` de Yahoo) pueden desfasar levemente en activos no-USD
- **FundamentalsPanel**: panel bento premium con `NumberTicker` (importado de `components/dashboard/NumberTicker.tsx`). Tooltips de información con posición `fixed` para evitar clipping en contenedores `overflow-y-auto`
- **PriceMarquee**: marquee header con tickers de `BENCHMARK_TICKERS` (`lib/market/benchmarks.ts`) — polling independiente de las watchlists del usuario
- **Overview** (`OverviewDashboard.tsx`): dashboard agregado en `/` (ya no redirige a watchlist). KPIs best/worst performer (`useTopPerformers`), contador "beating peers" (`usePeerComparison`), snapshot de mercado (`useRealtimePrices(BENCHMARK_TICKERS)`), teaser del Market Brief (`useNewsBrief`). Solo reutiliza hooks existentes — cero endpoints nuevos.
- **AssetDetailModal — Tabs**: 3 tabs (Summary · Calendar Years · Peers). Calendar Years usa `useCalendarYearReturns` gateado: solo fetchea cuando `activeTab === 'calendar'` (pasa `null` en otras tabs, `enabled: !!ticker` previene la request). `activeTab` se resetea al cerrar el modal. Todos los hooks son incondicionales (Rules of Hooks).
- **Onboarding**: `TourProvider` + `TourSpotlight` en `components/onboarding/`. `app/(dashboard)/layout.tsx` lee `profiles.onboarding_seen` y pasa la prop. Tour arranca automáticamente una sola vez (localStorage `evolve_onboarding_seen` como fallback). Al terminar/saltar persiste en Supabase via browser client (RLS permite UPDATE del propio perfil). Anchors `data-tour="..."` en `DashboardShell` y `WatchlistManager`.

### Sección de noticias (Market Brief)
- **Pipeline** (`lib/ai/news-pipeline.ts`, orquestado en `app/api/cron/news-pipeline/route.ts`): `enrichAssetProfiles` → `searchNews` (Tavily) → `rankCandidates` (pre-ranking determinista) → `selectTop7` (selección LLM) → `extractContent` (Firecrawl) → `analyzeAndSynthesize` (análisis/scoring LLM) → `matchAffectedSymbols` (matching determinista) → `selectFinalArticles` → insert en `market_briefs` + `market_news`
- **Cron**: Vercel dispara el POST con `Authorization: Bearer CRON_SECRET` los **Lun/Vie 13:00 UTC** (07:00 MX). `computeValidUntil()` fija la vigencia (Lun→Vie, Vie→Lun). **Guard anti-doble-ejecución con cota temporal** (`fifteenMinAgo`): salta solo si hay un brief `ready` aún válido (`valid_until > now`) **o** uno `generating` reciente (`created_at > now−15min`). **Auto-recuperación**: antes del guard, cualquier `generating` con `created_at < now−15min` (run que excedió `maxDuration=300s` y Vercel mató → fila atascada que antes bloqueaba TODOS los crons futuros) se marca `failed` (`metadata.error: 'abandoned…'`) para no bloquear la regeneración. **Logging** con prefijo `[news-cron]`: entrada al handler, filas recuperadas, decisión del guard (skip+motivo o proceed), `valid_until` calculado, SUCCESS (`briefId`) / FAILED (error real) — visible en Vercel logs
- **Lectura**: `GET /api/news/current` (auth) devuelve el brief vigente; si no hay vigente, sirve el último como `stale: true`. `useNewsBrief` lo consume; `NewsBlock` renderiza `WeeklyBriefCard` + grid de `NewsCard`
- **Cadena LLM** (`lib/ai/llm.ts`): `callLLM({ role })` recorre `NEWS_LLM_CHAIN` (default `gemini,groq,cerebras`); un proveedor sin API key se salta solo; reintentos con backoff ante 429/503/timeout. Modelos DISTINTOS para `analysis` vs `selection` (no compiten por TPM). `extractJson`/`sanitizeJsonString` parsean salidas sucias sin depender del modo JSON del proveedor
- **Relevancia de portafolio = 100% DETERMINISTA** (el LLM ya NO adivina `affected_tickers`): **Fase A** `enrichAssetProfiles` enriquece cada activo UNA vez (cacheado en `assets_metadata.relevance_profile`) con señales estables (entities, themes, geography, issuer); perfiles "pobres" (sin entities ni themes) NO se cachean → reintentan. **Fase B** `matchAffectedSymbols` cruza esos perfiles contra `title + full_text_md` con guardas estrictas (entity preferido; ticker literal solo con `\b` + MAYÚSCULAS o cashtag `$XXX`, nunca substring/case-insensitive; themes solo corroboran). Índices (`type='index'`) NO generan badge 🎯. `affected_tickers` (text[]) se deriva de `affected_symbols` para no romper frontend ni el índice GIN
- **Badge 🎯 multi-tenant**: se calcula en cliente (`NewsCard` filtra `affected_tickers` contra los tickers de la watchlist activa del usuario) — la misma fila de `market_news` muestra/oculta el badge por usuario
- **Scoring**: 5 dimensiones 0–5 (`macro_impact`, `surprise_factor`, `market_relevance`, `forward_implications`, `structural_vs_noise`) + `time_decay` → TOTAL máx 25. `portfolio_relevance` NO suma al total (solo informativo + garantía de inclusión). RATING A(19-25)/B(15-18)/C(11-14)/D(<11); SIGNAL STRONG/MODERATE/WEAK. Few-shot de calibración para reducir varianza. `selectFinalArticles` arma conteo variable 3–7 por umbral de calidad, con garantía de inclusión por portafolio (≥C/score≥11) sin exceder 7
- **FOCO GEOGRÁFICO EE.UU./México**: queries de Tavily, prompt de `selectTop7` y rubric de `analyzeAndSynthesize` priorizan Fed/macro de EE.UU., Banxico/peso, gobierno/empresas de EE.UU. y temas globales que mueven esos mercados (petróleo, geopolítica, grandes tecnológicas, treasuries). DESPRIORIZA fuerte decisiones de bancos centrales/política doméstica de OTROS países (Sudáfrica, Corea, etc.) salvo contagio claro a EE.UU./México descrito en el texto (`market_relevance`/`macro_impact` ≤2 en esos casos)
- **NO REDUNDANCIA** (regla en `selectTop7`): agrupa noticias del MISMO evento/sub-tema (p.ej. varias declaraciones de funcionarios de la Fed la misma semana = UN tema) y elige solo la MEJOR de cada grupo; una 2ª del mismo tema solo si aporta un ángulo nuevo (dato/postura opuesta/consecuencia distinta). Prefiere cobertura amplia sobre profundizar en un solo tema
- **Redacción** (`analyzeAndSynthesize`): `summary`/`insight` en español, neutral; prohibido inventar cifras (si el artículo no da el número, descríbelo cualitativamente); dirección suave permitida, recomendaciones prescriptivas no; lista de frases prohibidas para evitar relleno genérico
- **`published_at`**: usa la fecha del LLM si es válida; fallback a `published_date` de Tavily (en el objeto raw de `searchNews`) — la fecha aparece siempre que la haya, aunque el LLM no la devuelva bien.
- **Disparo manual**: `scripts/refresh-news.mjs` (ver Comandos). Verificación de la cadena LLM: `scripts/check-llm.mjs`
