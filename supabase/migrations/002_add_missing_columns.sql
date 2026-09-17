-- ============================================================
-- 002 — Columnas faltantes (drift de schema)
-- ============================================================
-- Qué hace: añade las 8 columnas que el código ya lee/escribe pero que el DDL
-- vigente no define, más `price_cache.fundamentals_refresh_started_at` (lease
-- que PR6 usará para deduplicar refrescos de fundamentals en vuelo).
--
-- CUÁNDO APLICAR: **antes** de desplegar el código de PR2/PR6. Es la única
-- migración de este lote que es segura de aplicar en cualquier momento.
--
-- Por qué urge: `app/api/market/quote/route.ts` mete `currency` en el upsert
-- PRINCIPAL de `price_cache`. En una base sin esa columna **todo** el upsert
-- falla con PGRST204 y el error solo se loguea → los precios se pintan desde
-- Yahoo pero la caché jamás se puebla. `price_to_book` y `median_market_cap`
-- comparten el mecanismo vía `rowToQuote`.
--
-- Seguridad de la operación:
--   · Aditivo puro. Ningún ALTER reescribe la tabla.
--   · `not null default false` sobre `profiles` es metadata-only en PG11+
--     (no hay reescritura ni lock largo) y `profiles` tiene decenas de filas.
--   · `add column if not exists` → idempotente. Si el paso 0.2 del runbook
--     mostró que alguna ya existe, este archivo la salta sin error.
--
-- ⚠️ `add column if not exists` NO cambia una columna preexistente. Si alguna
-- existe con otro tipo (p.ej. `inception_date text` en vez de `date`), este
-- archivo la deja como está y el drift sigue. El paso 0.2 del runbook lista
-- nombres; si sospechas de un tipo, compáralo contra la tabla de abajo.
--
-- Procedencia de cada tipo (medido, no asumido):
--   currency                        text        ← lib/market/finnhub.ts:46 `meta.currency`
--   inception_date                  date        ← finnhub.ts:202 emite 'YYYY-MM-DD' (toISOString().split('T')[0])
--   morningstar_category            text        ← finnhub.ts:212 `fundProfile.categoryName`
--   global_category                 text        ← finnhub.ts:213 `toGlobalCategory(...)`
--   price_to_book                   numeric     ← finnhub.ts:210 `equityHoldings.priceToBook` (types/index.ts:133 number|null)
--   median_market_cap               numeric     ← finnhub.ts:211 `equityHoldings.medianMarketCap` (types/index.ts:134 number|null)
--   fundamentals_refresh_started_at timestamptz ← nueva; hermana de `fundamentals_fetched_at`
--   profiles.onboarding_seen        boolean nn  ← app/(dashboard)/layout.tsx:15 con fallback `?? false`
--   profiles.is_team_evolve         boolean nn  ← hooks/useWatchlistAssets.ts:230 `.eq('is_team_evolve', true)`
-- ============================================================

-- price_cache ------------------------------------------------
alter table public.price_cache add column if not exists currency                        text;
alter table public.price_cache add column if not exists inception_date                  date;
alter table public.price_cache add column if not exists morningstar_category            text;
alter table public.price_cache add column if not exists global_category                 text;
alter table public.price_cache add column if not exists price_to_book                   numeric;
alter table public.price_cache add column if not exists median_market_cap               numeric;
alter table public.price_cache add column if not exists fundamentals_refresh_started_at timestamptz;

comment on column public.price_cache.fundamentals_refresh_started_at is
  'Lease de refresco de fundamentals: se sella al arrancar un fetch para que dos '
  'invocaciones concurrentes no dupliquen el trabajo. NULL = sin refresco en vuelo. '
  'Un valor viejo (> unos minutos) se considera lease caducado, no trabajo activo.';

-- profiles ---------------------------------------------------
-- `not null default false`: metadata-only en PG11+, sin reescritura de tabla.
alter table public.profiles add column if not exists onboarding_seen boolean not null default false;
alter table public.profiles add column if not exists is_team_evolve  boolean not null default false;

comment on column public.profiles.is_team_evolve is
  'Pertenencia a Team Evolve. Se gestiona FUERA de la app (scripts/manage-team-evolve.mjs, '
  'service role). Ningún cliente autenticado debe poder escribirlo ni enumerar el roster: '
  'tras 004 el roster solo sale por POST /api/watchlists/[id]/share-team, que devuelve un conteo.';

-- ============================================================
-- REVERSIÓN (comentada a propósito — ejecutar a mano si hace falta)
-- ============================================================
-- ⚠️ Revertir BORRA DATOS: la caché de fundamentals y el estado de onboarding /
-- Team Evolve de todos los usuarios. Revertir el commit de código NO revierte
-- esto. Solo tiene sentido si 002 se aplicó por error en la base equivocada.
--
-- alter table public.price_cache drop column if exists currency;
-- alter table public.price_cache drop column if exists inception_date;
-- alter table public.price_cache drop column if exists morningstar_category;
-- alter table public.price_cache drop column if exists global_category;
-- alter table public.price_cache drop column if exists price_to_book;
-- alter table public.price_cache drop column if exists median_market_cap;
-- alter table public.price_cache drop column if exists fundamentals_refresh_started_at;
-- alter table public.profiles    drop column if exists onboarding_seen;
-- alter table public.profiles    drop column if exists is_team_evolve;
