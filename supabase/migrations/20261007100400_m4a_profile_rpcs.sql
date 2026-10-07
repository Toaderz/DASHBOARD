-- M4a · SEC-08 · Funciones que reemplazan la lectura abierta de profiles (paso 1 de 3)
-- Certeza: CONFIRMADO (Anexo A, 1b) que authenticated_read_profiles deja a cualquier autenticado leer
-- id, email, full_name, is_team_evolve de TODOS los perfiles.
--
-- ORDEN DE M4 (no saltarse pasos):
--   1) M4a (este archivo): crea 3 funciones. No cambia ningún comportamiento actual. Seguro de aplicar solo.
--   2) Desplegar el código de la rama (hooks/useWatchlistAssets.ts ya las usa). Si se despliega ANTES
--      de M4a, la UI de compartir falla.
--   3) M4b: borrar la política authenticated_read_profiles. Si se hace antes del paso 2, compartir se rompe.
--
-- Lectores de profiles desde el navegador (grep 2026-10-07), todos cubiertos:
--   · useWatchlists            → correos de los dueños de listas compartidas conmigo → get_shared_owner_emails()
--   · useWatchlistShares       → correos de quienes reciben MIS listas               → get_share_recipients(lista)
--   · addTeamShares            → ids de Team Evolve (sin mí)                         → get_team_member_ids()
--   · (dashboard)/layout.tsx y TourProvider leen/escriben SOLO su propio perfil (política "own profile select/update").
--   · /api/users/find y manage-team-evolve usan service_role (no dependen de la política).
--
-- Nota de diseño: las tres son SECURITY DEFINER con search_path fijo, devuelven solo lo mínimo y solo para
-- el caller (auth.uid()). Quien no tenga sesión recibe 0 filas. EXECUTE solo para authenticated.
--
-- ── PRECHECK ─────────────────────────────────────────────────────────────────────────────
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and proname in ('get_shared_owner_emails','get_share_recipients','get_team_member_ids');
--   -- Debe devolver 0 filas antes de aplicar.
--
-- ── REVERSA (exacta; solo válida si M4b NO se aplicó o ya se revirtió) ───────────────────
--   drop function if exists public.get_shared_owner_emails();
--   drop function if exists public.get_share_recipients(uuid);
--   drop function if exists public.get_team_member_ids();
--
-- ── POSTCHECK (con una sesión real): abrir una lista compartida contigo y ver el correo del dueño;
--    abrir el diálogo de compartir de una lista propia y ver los correos; usar "Team Evolve".

create or replace function public.get_shared_owner_emails()
returns table (id uuid, email text)
language sql stable security definer
set search_path = public
as $$
  select p.id, p.email
  from public.profiles p
  where auth.uid() is not null
    and p.id in (
      select w.user_id
      from public.watchlists w
      where w.id in (select s.watchlist_id from public.watchlist_shares s where s.shared_with_user_id = auth.uid())
    );
$$;

create or replace function public.get_share_recipients(p_watchlist_id uuid)
returns table (id uuid, email text)
language sql stable security definer
set search_path = public
as $$
  select p.id, p.email
  from public.watchlist_shares s
  join public.profiles p on p.id = s.shared_with_user_id
  where auth.uid() is not null
    and s.watchlist_id = p_watchlist_id
    and exists (select 1 from public.watchlists w where w.id = p_watchlist_id and w.user_id = auth.uid());
$$;

create or replace function public.get_team_member_ids()
returns table (id uuid)
language sql stable security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where auth.uid() is not null
    and p.is_team_evolve = true
    and p.id <> auth.uid();
$$;

revoke execute on function public.get_shared_owner_emails()   from public, anon, authenticated;
revoke execute on function public.get_share_recipients(uuid)  from public, anon, authenticated;
revoke execute on function public.get_team_member_ids()       from public, anon, authenticated;
grant  execute on function public.get_shared_owner_emails()   to authenticated;
grant  execute on function public.get_share_recipients(uuid)  to authenticated;
grant  execute on function public.get_team_member_ids()       to authenticated;
