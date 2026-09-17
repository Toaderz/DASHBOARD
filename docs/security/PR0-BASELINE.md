# PR0 — Production safety baseline

Estado del sistema **antes** de cualquier cambio de remediación. No despliega nada.
Fecha de medición: 2026-09-17 · rama `claude/security-audit-plan-xna7ct` · HEAD `8b8cba6`.

Su función es que cualquier fallo posterior sea **atribuible**: si `tsc` o `build` se rompen
en un PR, aquí está la prueba de que no venían rotos.

---

## 1. Baseline de construcción (medido, no asumido)

| Comprobación | Resultado |
|---|---|
| `npm ci` sobre el lockfile commiteado | ✅ exit 0 |
| `npx tsc --noEmit` | ✅ **0 errores** |
| `npm run build` (Webpack, con type-check) | ⚠️ **exit 1** — no por regresión: `/login` se prerenderiza estáticamente y construye un cliente de Supabase, así que sin `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` el prerender falla con `@supabase/ssr: Your project's URL and API key are required`. Con dos valores placeholder pasa con exit 0 |
| `npm test` | ❌ **no existe script de tests** |
| `npm run lint` | ❌ `next lint` fue eliminado en Next 16 **y** no hay ningún archivo de configuración de ESLint → **cero análisis estático** |

⚠️ **Corrección a una medición previa de este mismo documento.** La primera pasada afirmó que el
build baseline pasaba. Era falso: el comando envolvía `npm run build` en una tubería a `tee`, así
que el código de salida leído era el de `tee` (siempre 0) y no el del build. El log terminaba en
`BUILD_EXIT=1`. La conclusión de fondo no cambia — **no hay regresión de build**, el fallo es un
requisito de entorno preexistente — pero el baseline honesto es "falla sin env vars", no "pasa".
Consecuencia accionable: **CI debe inyectar esas dos variables** o `/login` seguirá rompiendo el
build.

Nota: `eslint@9.39.4` y `eslint-config-next` ya están instalados como dependencias directas.
Lo que falta no es el binario, es la configuración. Sin `eslint.config.*`, ESLint 9 no analiza nada.

## 2. Superficie vulnerable de dependencias

`npm audit` sobre el lockfile commiteado: **16 paquetes vulnerables**.

```
critical: 1   high: 11   moderate: 1   low: 3
```

| Severidad | Paquete | Directa | Rango vulnerable | Vector principal |
|---|---|---|---|---|
| **CRITICAL** | `next` | sí | `9.3.4-canary.0 - 16.3.2` | **Bypass de Middleware/Proxy en App Router** vía rutas segment-prefetch; DoS en Server Actions. Aplica directamente a `proxy.ts` |
| HIGH | `postcss` | **sí** | `<=8.5.22` | XSS vía `</style>` sin escapar; lectura de archivo arbitraria vía `sourceMappingURL` |
| HIGH | `sharp` | no (vía `next`) | `<=0.35.4-rc.0` | CVEs heredados de libvips/libheif — relevante porque `next.config.ts` tiene `remotePatterns: hostname '**'` |
| HIGH | `firecrawl` | sí | `4.18.1 - 4.25.1` | vía `axios` |
| HIGH | `axios` | no | `1.0.0 - 1.17.0` | ReDoS; fuga de `Proxy-Authorization` en redirect HTTP→HTTPS |
| HIGH | `form-data` | no (vía `axios`) | `4.0.0 - 4.0.5` | Inyección CRLF en nombres de campo multipart |
| HIGH | `ws` | no (vía `supabase-js`) | `8.0.0 - 8.20.1` | Divulgación de memoria no inicializada; DoS |
| HIGH | `@serwist/next` | sí | `9.4.2 - 9.5.12` | vía `browserslist` |
| HIGH | `browserslist` | no | `<=4.28.6` | Crecimiento de memoria no acotado; escritura de prototipo |
| HIGH | `nanoid` | no (vía `postcss`) | `<=3.3.17` | Bucle infinito con `size` 0/negativo |
| HIGH | `js-yaml` | no (vía `@eslint/eslintrc`) | `4.0.0 - 4.3.1` | DoS cuadrático en merge keys — **build-time** |
| HIGH | `brace-expansion` | no (vía `glob`) | `<=1.1.17 \|\| 3.0.0 - 5.0.8` | DoS por expansión no acotada — **build-time** |
| MODERATE | `baseline-browser-mapping` | no | `>=2.0.0 <2.11.0` | Terminación de proceso por entrada inválida — **build-time** |
| LOW | `@babel/core` | no | `<=7.29.0` | Lectura de archivo vía `sourceMappingURL` — **build-time** |
| LOW | `esbuild` | no | `0.27.3 - 0.28.0` | Lectura de archivo con dev server **en Windows** — **build-time** |
| LOW | `postcss-selector-parser` | no | `6.1.0 - 6.1.2` | DoS por recursión de AST — **build-time** |

⚠️ El fix que propone `npm audit` para `browserslist` es **degradar `@serwist/next` a 9.4.1**, un
major hacia atrás. Es incorrecto: `@serwist/build@9.5.12` simplemente **dejó de depender** de
`browserslist`. Aplicar `npm audit fix --force` aquí habría hecho un downgrade de major a ciegas.

Datos crudos: `npm audit --json`, `npm ls --depth=0` y `npm explain` por paquete quedaron
capturados durante la medición; la tabla de residual **después** de PR1 va en el commit de PR1.

## 3. Drift de schema — 8 columnas

El código lee o escribe 8 columnas que el DDL vigente de `supabase/schema.sql` **no define**.
Tres de ellas no tienen ni texto de migración comentado. Ver la tabla del apéndice de
`docs/PLAN-REMEDIACION-SEGURIDAD.md`.

Modo de fallo en una base de datos limpia: `app/api/market/quote/route.ts` mete `currency` en el
**upsert principal** de `price_cache`, así que **todo** upsert falla con `PGRST204` y el error solo
se loguea → los precios se renderizan desde Yahoo pero la caché **jamás** se puebla.
`price_to_book` y `median_market_cap` comparten el mismo mecanismo vía `rowToQuote`.

## 4. Matriz de permisos de funciones — objetivo de `003_harden_seed_grants.sql`

Funciones `SECURITY DEFINER` en el DDL vigente (`supabase/schema.sql`):

| Función | Línea | SEC DEF | PUBLIC | anon | authenticated | service_role | Invocada realmente por |
|---|---|---|---|---|---|---|---|
| `handle_new_user()` | 187 | sí | ❌ | ❌ | ❌ | ❌ | trigger `on_auth_user_created` en `auth.users` |
| `seed_first_trust_watchlist(uuid)` | 238 | sí | ❌ | ❌ | ❌ | ❌ | cadena de trigger (como *owner*) |
| `seed_evolve_universe_watchlist(uuid)` | 444 | sí | ❌ | ❌ | ❌ | ❌ | cadena de trigger (como *owner*) |
| `seed_pershing_square_watchlist(uuid)` | 538 | sí | ❌ | ❌ | ❌ | ❌ | cadena de trigger (como *owner*) |
| `handle_new_user_default_watchlists()` | 595 | sí | ❌ | ❌ | ❌ | ❌ | trigger `on_profile_created_seed_watchlists` |
| `get_shared_watchlist_ids()` | 635 | sí | ❌ | ❌ | ✅ **conservar** | ✅ | **3 políticas RLS** (`:657`, `:731`) |
| `get_top_tickers()` | 831 (**solo comentada**) | sí | ❌ | ❌ | ❌ | ✅ | `lib/ai/news-pipeline.ts:111` |

Dos cosas que hay que respetar al escribir la migración:

- **Un `REVOKE` general rompe el compartir.** `get_shared_watchlist_ids()` vive **dentro** de
  políticas RLS; si `authenticated` pierde `EXECUTE`, las watchlists compartidas dejan de leerse.
- **`get_top_tickers()` puede no existir** en un entorno dado (está solo en el bloque comentado,
  pero el pipeline la llama). Los grants sobre ella deben ser **condicionales a su existencia**.

Por qué la cadena de signup sobrevive al `REVOKE`: `EXECUTE` se verifica contra `current_user`, y
dentro de un `SECURITY DEFINER` ese es el **owner**, no el rol que originó la petición.
`revoke ... from public` no toca los privilegios implícitos del owner.
**Verificar `proowner` en el entorno real antes de desplegar**: si alguna la creó otro rol, la
suposición se cae. La consulta está en `docs/security/RUNBOOK-SUPABASE.md`.

⚠️ **Lo que NO se hace**: añadir la guarda `if auth.uid() is distinct from p_user_id then raise`
que recomendaba la auditoría. En el signup el INSERT lo ejecuta GoTrue sin JWT → `auth.uid()` es
NULL → `NULL is distinct from uuid` es verdadero → la excepción **aborta la creación del usuario
completa**. `REVOKE` enumerado es el único control real.

## 5. Matriz de ownership por columna — objetivo de `005_restrict_assets_metadata.sql`

Columnas reales de `assets_metadata`: `ticker`, `name`, `type`, `sector`, `region`, `industry`,
`benchmark`, `manager`, `relevance_profile`, `updated_at`.

| Campo | Escribible por cliente (`authenticated`) | Escribible por backend (service role) |
|---|---|---|
| `ticker`, `name`, `type` | ✅ (con validación de forma) | ✅ |
| `sector`, `region`, `industry`, `benchmark`, `manager`, `relevance_profile` | ❌ **null obligatorio** | ✅ |

Hoy la política de INSERT es solo `auth.uid() is not null`: cualquier usuario autenticado puede
escribir campos curados.

⚠️ Trampa de orden al endurecer: el `WITH CHECK` se evalúa sobre la fila **después** de los
triggers `BEFORE`. Si el ticker no se normaliza, un valor en minúsculas falla el check, el error
se descarta en el cliente y `addAsset` acaba en FK `23503` → "añadir activo" se rompe en silencio.
Por eso la normalización va en un trigger `before insert`, no solo en el cliente.

## 6. Inventario de invariantes de producto

Lo que **no debe cambiar** en ningún PR hasta PR8 inclusive. Es el criterio de reversión.

| # | Invariante | Cómo se comprueba |
|---|---|---|
| I-1 | **Beating Peers manda la unión activos∪peers (~475 tickers)** en un solo POST, sin truncar | `/vs-peers` en preview: ningún activo muestra "— sin dato" que antes tuviera dato. `MAX_TICKERS` **se mantiene en 1500** |
| I-2 | Top/Bottom Performers responden en los **9 periodos** (`1W,1M,6M,YTD,1Y,3Y,5Y,10Y,MAX`) + 7 años calendario | `/top10` y `/bottom10` con cada periodo |
| I-3 | El watchlist renderiza precios y todas las columnas de métricas | `/watchlist/[id]` |
| I-4 | Compartir watchlists funciona, **incluido Team Evolve** | Diálogo de compartir: por email y "Team Evolve" |
| I-5 | **El signup siembra 3 watchlists** (First Trust, Evolve Universe, Pershing Square) | `scripts/verify-seed.sql` (PR4) |
| I-6 | **Cifras financieras idénticas** hasta PR8 | Golden fixtures de PR8, comparando antes vs después |
| I-7 | El login no hace ninguna petición autenticada | Verificado: cero `fetch()` en `app/(auth)/login/` — escenas Canvas/Framer con datos fijos |
| I-8 | El service worker no cachea `/api/` | Verificado: `NetworkOnly` para `/^\/api\//` en `app/sw.ts` |

I-7 e I-8 son los que hacen que **PR3 (exigir auth) sea seguro**: los ~20 llamadores de las rutas
de market viven todos bajo `app/(dashboard)/`, que ya está detrás del gate de sesión.

## 7. Nota de arquitectura que condiciona PR3

`lib/supabase/middleware.ts:39` **exime `/api` del gate de auth** y `proxy.ts` solo refresca la
sesión: **no hay red de seguridad** en el middleware para las rutas de API. Además
`updateSession` ya llama a `auth.getUser()` en toda petición — incluidas `/api/*`, porque
`:30-32` corre **antes** del check — así que añadir `requireUser()` deja dos round-trips a GoTrue
en una ruta que se sondea cada 5 s. Se acepta por corrección; optimizar solo si aparece en el p95.

## 8. Plan de rollback

Cada unidad es **un commit**, revertible por separado (`git revert <sha>`). Orden de riesgo
descendente y qué hacer si algo se rompe en producción:

| Unidad | Riesgo principal | Rollback |
|---|---|---|
| PR1 dependencias | `firecrawl` (+15 minors) o `@supabase/supabase-js` (+11 minors, toca auth) rompen en runtime | `git revert` del commit → `npm ci`. No hay estado que deshacer |
| PR2 foundations | Cambio de comportamiento en `quote`/`returns` bajo carga | `git revert`. Sin DDL, sin estado |
| PR3 auth | **El único que puede dejar fuera a un usuario real** | `git revert` y redespliegue inmediato. Verificar primero en preview con `/vs-peers` |
| PR4 base de datos | Migraciones aditivas (002) son seguras; los cambios de política (004/005) pueden romper lecturas de navegador | Las migraciones son forward-only: **cada delta lleva su propio bloque de reversión comentado**. Revertir el commit de código NO revierte la DB |
| PR5 noticias/LLM | Menos artículos en el brief si la validación descarta de más | `git revert`. `market_briefs.metadata` registra `articles_received/valid/discarded` para diagnosticar antes de revertir |
| PR6 performance | **Cifras financieras** si la migración al POST bulk cambia la semántica | `git revert`. Los golden de PR8 deben detectarlo **antes** del despliegue |
| PR7 plataforma | Headers o CSP rompen Framer Motion / Supabase / Serwist | Fase A son headers inertes; la CSP entra en `Report-Only` y nunca en enforcement sin medición |
| PR8 scoring | **Cambio de producto visible**: más C/D, menos A/STRONG | `git revert` restaura la autoridad del LLM sobre `score`/`rating` |

Regla de oro del orden código↔DB: **las columnas se añaden antes de desplegar el código que las
usa** (002 es aditivo puro y seguro en cualquier momento), y **las políticas se endurecen después
de desplegar el código que ya no las necesita** (004/005 van detrás de sus endpoints de servidor).

## 9. Lo que NO se puede verificar en el entorno de ejecución

Honestidad sobre el alcance. Esto queda como checklist para ejecutar en la máquina del usuario:

| Pendiente | Por qué | Dónde está el procedimiento |
|---|---|---|
| Baseline de migraciones (`db pull` + `migration repair`) | **El CLI de Supabase no está instalado** y no hay proyecto linkeado | `docs/security/RUNBOOK-SUPABASE.md` |
| `db reset` / `db diff --linked` / `db lint` | Idem | Idem |
| Verificación de `proowner` y `proacl` reales | Requiere conexión a la base de datos | Idem |
| Smoke test de login/refresh tras subir `supabase-js` | No hay credenciales en el entorno | Checklist de PR1 |
| Corrida real del pipeline de noticias tras subir `firecrawl` | Requiere `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, claves de LLM | Checklist de PR1 |
| `/vs-peers` con la unión de ~475 tickers | Requiere preview deploy con datos reales | Checklist de PR3 |
| Prerender de `/login` con env reales | Aquí solo pasa con placeholders | Checklist de PR1 |
