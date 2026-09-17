-- ============================================================
-- 005 — Acotar qué puede escribir un cliente en `assets_metadata`
-- ============================================================
-- Qué hace: acota el WITH CHECK de la política de INSERT y añade un trigger
-- BEFORE INSERT que normaliza el ticker.
--
-- CUÁNDO APLICAR: **después** de desplegar (a) la normalización de ticker en
-- `components/dashboard/WatchlistView.tsx` y (b) el cambio de cliente admin en
-- `app/api/peers/init/route.ts`. Si se aplica antes, "añadir activo" falla en
-- silencio (ver la trampa de orden de evaluación, abajo).
--
-- ------------------------------------------------------------
-- QUÉ SE ACOTA (matriz de ownership por columna, PR0 §5)
-- ------------------------------------------------------------
--   ticker, name, type                         → escribibles por el cliente, CON validación de forma.
--   sector, region, industry, benchmark,
--   manager, relevance_profile                 → **null obligatorio** para el cliente.
--                                                Solo el service role los puebla
--                                                (backfill de quote/route.ts,
--                                                enriquecimiento del pipeline de noticias).
--
-- Hoy la política es solo `auth.uid() is not null`: cualquier usuario logueado
-- puede sobreescribir campos curados del catálogo global, que es compartido por
-- todos los usuarios y alimenta el pipeline de IA.
--
-- ------------------------------------------------------------
-- NO SE ELIMINA LA POLÍTICA, SE ACOTA
-- ------------------------------------------------------------
-- Borrarla sin más crearía un peligro de ORDEN código↔DB: el cliente seguiría
-- insertando en `assets_metadata` y "añadir activo" quedaría roto hasta el
-- despliegue del código que dejara de hacerlo. Se conserva el mismo NOMBRE de
-- política para que el inventario de RLS no cambie de forma.
--
-- ------------------------------------------------------------
-- ⚠️ TRAMPA DE ORDEN DE EVALUACIÓN — por qué el trigger es obligatorio
-- ------------------------------------------------------------
-- El WITH CHECK de RLS se evalúa sobre la fila **después** de los triggers
-- BEFORE. Si el ticker no se normaliza ahí, esta secuencia rompe el producto
-- en silencio:
--   1. el usuario busca un ticker y llega 'aapl' (o con espacios),
--   2. el upsert a assets_metadata falla el WITH CHECK,
--   3. `handleAddAsset` no mira ese error (`await supabase...upsert(...)` sin
--      comprobar `error`),
--   4. `addAsset('aapl')` inserta en watchlist_assets y revienta con FK 23503
--      `watchlist_assets_asset_ticker_fkey`.
-- Resultado: "añadir activo" deja de funcionar y el usuario no ve ningún
-- mensaje. Por eso `upper(btrim(...))` va en un trigger BEFORE INSERT del
-- servidor, y además (cinturón y tirantes) en `handleAddAsset`.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Normalización del ticker en el servidor
-- ------------------------------------------------------------
create or replace function public.normalize_asset_ticker()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.ticker := upper(btrim(new.ticker));
  return new;
end;
$$;

comment on function public.normalize_asset_ticker() is
  'Normaliza assets_metadata.ticker a MAYÚSCULAS sin espacios ANTES de que RLS '
  'evalúe el WITH CHECK (los triggers BEFORE corren primero). Sin esto, un ticker '
  'en minúsculas falla el check, el cliente descarta el error y addAsset acaba en '
  'FK 23503: "añadir activo" se rompe en silencio.';

drop trigger if exists assets_metadata_normalize_ticker on public.assets_metadata;
create trigger assets_metadata_normalize_ticker
  before insert on public.assets_metadata
  for each row execute function public.normalize_asset_ticker();

-- ------------------------------------------------------------
-- 2. La política de INSERT, acotada
-- ------------------------------------------------------------
drop policy if exists "auth users insert assets" on public.assets_metadata;

create policy "auth users insert assets" on public.assets_metadata
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    -- Forma del ticker. El trigger de arriba ya lo normalizó, así que esta
    -- comparación es una aserción, no un filtro de mayúsculas.
    -- Cubre el catálogo real: '^GSPC' (índices), 'BRK-B', 'PSH.L',
    -- '0P0001CZXM.L' (fondos CT), 'GBPUSD=X' (pares FX). Máx. 12 chars hoy.
    and ticker = upper(btrim(ticker))
    and ticker ~ '^\^?[A-Z0-9][A-Z0-9.=-]{0,19}$'
    -- Tope de longitud del nombre. El más largo del catálogo tiene 66 chars.
    and name is not null
    and length(btrim(name)) between 1 and 200
    -- Tipo dentro del enum (el CHECK de tabla ya lo exige; explícito aquí para
    -- que la política se lea sola).
    and type in ('stock','etf','index','fund','crypto')
    -- Campos CURADOS: el cliente no los escribe. Solo el service role, que
    -- salta RLS y por tanto no evalúa este WITH CHECK.
    and sector            is null
    and region            is null
    and industry          is null
    and benchmark         is null
    and manager           is null
    and relevance_profile is null
  );

-- Recordatorio: `public read assets` (SELECT using(true)) NO se toca — el
-- catálogo sigue siendo de lectura pública. Y sigue sin haber política de
-- UPDATE ni de DELETE para clientes: eso es deliberado.

-- ============================================================
-- REVERSIÓN (comentada a propósito)
-- ============================================================
-- Síntoma que obliga a revertir: "añadir activo" deja de funcionar (el activo
-- no aparece en la lista tras buscarlo). Casi siempre significa que el código
-- normalizado todavía no estaba desplegado.
--
-- drop policy if exists "auth users insert assets" on public.assets_metadata;
-- create policy "auth users insert assets" on public.assets_metadata
--   for insert with check (auth.uid() is not null);
-- drop trigger  if exists assets_metadata_normalize_ticker on public.assets_metadata;
-- drop function if exists public.normalize_asset_ticker();
--
-- Comprobación funcional tras aplicar, con una cuenta real:
--   · buscar y añadir un ticker nuevo a una watchlist → aparece en la tabla.
--   · repetir con un ticker ya existente → no duplica ni da error.
-- Test negativo ejecutable (escribir un campo curado debe fallar) en
-- scripts/verify-rls.sql.
