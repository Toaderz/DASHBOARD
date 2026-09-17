-- ============================================================
-- 004 — Acotar la lectura de `profiles` a contrapartes de share
-- ============================================================
-- Qué hace: sustituye la política permisiva `authenticated_read_profiles`
-- (`using (auth.uid() is not null)`) por una acotada a las **contrapartes de
-- share** del usuario que consulta.
--
-- CUÁNDO APLICAR: **después** de desplegar `POST /api/watchlists/[id]/share-team`
-- (PR4). Si se aplica antes, "compartir con Team Evolve" se rompe, porque el
-- cliente todavía enumera el roster con `.eq('is_team_evolve', true)`.
--
-- ------------------------------------------------------------
-- POR QUÉ LA POLÍTICA ACTUAL NO SIRVE
-- ------------------------------------------------------------
-- Las políticas de Postgres son PERMISIVAS por defecto: se OR-ean. Tener
-- `own profile select` (`auth.uid() = id`) junto a `authenticated_read_profiles`
-- (`auth.uid() is not null`) significa que **gana la amplia**: cualquier usuario
-- logueado puede leer el email de todos los usuarios del sistema, y además
-- enumerar el roster de Team Evolve filtrando por `is_team_evolve`.
--
-- ------------------------------------------------------------
-- POR QUÉ UNA FUNCIÓN SIN PARÁMETROS
-- ------------------------------------------------------------
-- `get_share_counterpart_ids()` no recibe nada: deriva la identidad de
-- `auth.uid()` **internamente**. Así no hay ningún argumento que un cliente
-- pueda falsificar para leer las contrapartes de otro. Es el mismo patrón que
-- `get_shared_watchlist_ids()`.
-- Y es SECURITY DEFINER por la misma razón que aquélla: al leer
-- `watchlist_shares` / `watchlists` sin RLS rompe la recursión
-- profiles → watchlist_shares → watchlists → (políticas) → profiles.
--
-- ------------------------------------------------------------
-- LECTURAS DE NAVEGADOR QUE DEBEN SEGUIR FUNCIONANDO (verificadas)
-- ------------------------------------------------------------
--   hooks/useWatchlistAssets.ts:27  — `profiles(id,email)` de los DUEÑOS de las
--       watchlists compartidas conmigo.       → cubierto por la rama 1 del UNION.
--   hooks/useWatchlistAssets.ts:184 — `profiles(id,email)` de los DESTINATARIOS
--       de shares de MIS watchlists.          → cubierto por la rama 2 del UNION.
--   (el propio perfil sigue cubierto por la política `own profile select`,
--    que este archivo NO toca)
--
-- LECTURA QUE SE ROMPE A PROPÓSITO:
--   hooks/useWatchlistAssets.ts:228 (`addTeamShares`) — enumeraba el roster con
--       `.eq('is_team_evolve', true)`. NO es una contraparte: es exactamente la
--       enumeración que esta migración cierra. La sustituye
--       `POST /api/watchlists/[id]/share-team`, que hace el write completo en
--       servidor con service role, comprueba propiedad de la watchlist y
--       devuelve **solo `{ count }`** — el roster no sale del servidor.
-- ============================================================

-- ------------------------------------------------------------
-- 1. La función de contrapartes
-- ------------------------------------------------------------
create or replace function public.get_share_counterpart_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  -- Rama 1: dueños de watchlists compartidas CONMIGO.
  select w.user_id
  from   watchlist_shares s
  join   watchlists       w on w.id = s.watchlist_id
  where  s.shared_with_user_id = auth.uid()
  union
  -- Rama 2: destinatarios de shares de MIS watchlists.
  select s.shared_with_user_id
  from   watchlist_shares s
  join   watchlists       w on w.id = s.watchlist_id
  where  w.user_id = auth.uid()
$$;

comment on function public.get_share_counterpart_ids() is
  'IDs de perfiles con los que el usuario actual tiene una relación de share '
  '(dueños de listas compartidas conmigo + destinatarios de shares de mis listas). '
  'Sin parámetros a propósito: deriva la identidad de auth.uid(), así no hay nada '
  'que falsificar. SECURITY DEFINER para romper la recursión de RLS.';

-- Mismo criterio de grants que get_shared_watchlist_ids(): se evalúa dentro de
-- una política que aplica a `authenticated`, así que ese rol NECESITA EXECUTE.
revoke execute on function public.get_share_counterpart_ids() from public, anon;
grant  execute on function public.get_share_counterpart_ids() to authenticated, service_role;

-- ------------------------------------------------------------
-- 2. Sustituir la política amplia
-- ------------------------------------------------------------
-- Postgres no tiene `create policy if not exists`: el patrón idempotente es
-- drop-if-exists + create.
drop policy if exists "authenticated_read_profiles"     on public.profiles;
drop policy if exists "share_counterpart_read_profiles" on public.profiles;

create policy "share_counterpart_read_profiles" on public.profiles
  for select
  to authenticated
  using (id in (select public.get_share_counterpart_ids()));

-- Nota: `own profile select` / `own profile insert` / `own profile update`
-- siguen intactas. El usuario sigue leyendo su propio perfil por esa vía.

-- ============================================================
-- REVERSIÓN (comentada a propósito)
-- ============================================================
-- Si tras aplicar esto el diálogo de compartir deja de mostrar emails, es señal
-- de que el despliegue del endpoint `share-team` no había llegado. Restaura:
--
-- drop policy if exists "share_counterpart_read_profiles" on public.profiles;
-- create policy "authenticated_read_profiles" on public.profiles
--   for select using (auth.uid() is not null);
-- -- (opcional) drop function if exists public.get_share_counterpart_ids();
--
-- Comprobación funcional tras aplicar, con dos cuentas reales:
--   · A comparte una lista con B  → B ve "de @A" en el sidebar (rama 1).
--   · A abre el diálogo de share  → ve el email de B en la lista (rama 2).
--   · A pulsa "Team Evolve"       → responde un conteo (vía el endpoint, no RLS).
--   · A consulta profiles de C (sin relación) → devuelve 0 filas.
-- Los tests negativos ejecutables están en scripts/verify-rls.sql.
