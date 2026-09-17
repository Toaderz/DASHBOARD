-- ============================================================
-- 003 — Endurecer los grants de las funciones SECURITY DEFINER
-- ============================================================
-- Qué hace: SOLO grants. Ni un cuerpo de función se toca.
--
-- CUÁNDO APLICAR: tras 002. No depende del despliegue de código: ninguna ruta
-- ni cliente del navegador invoca estas RPC hoy.
--
-- PRECONDICIÓN OBLIGATORIA (paso 0.1 del runbook): todas estas funciones deben
-- reportar `owner = postgres` y `security_definer = t`. Si alguna la creó otro
-- rol, la suposición de abajo se cae y hay que PARAR.
--
-- ------------------------------------------------------------
-- POR QUÉ LA CADENA DE SIGNUP SOBREVIVE AL REVOKE
-- ------------------------------------------------------------
-- Cadena: auth.users INSERT → on_auth_user_created → handle_new_user()
--         → INSERT profiles → on_profile_created_seed_watchlists
--         → handle_new_user_default_watchlists() → 3 × seed_*_watchlist(uuid).
--
-- El privilegio EXECUTE se comprueba contra `current_user`. Dentro de una
-- función SECURITY DEFINER, `current_user` es el **owner** de esa función, no
-- el rol que originó la petición. `handle_new_user_default_watchlists()` es
-- SECURITY DEFINER y propiedad de `postgres`, así que cuando llama a las tres
-- seed el chequeo se hace contra `postgres` — que es su owner. Y `REVOKE ...
-- FROM PUBLIC` no toca los privilegios implícitos del owner sobre su propio
-- objeto. Resultado: GoTrue/`anon`/`authenticated` dejan de poder invocarlas
-- directamente, y el trigger sigue funcionando exactamente igual.
--
-- ------------------------------------------------------------
-- POR QUÉ **NO** SE AÑADE LA GUARDA `auth.uid() IS DISTINCT FROM p_user_id`
-- ------------------------------------------------------------
-- La auditoría pedía meter dentro de cada seed:
--     if auth.uid() is distinct from p_user_id then raise exception ... end if;
-- Se RECHAZA. En el signup el INSERT sobre auth.users lo hace GoTrue **sin
-- JWT** → `auth.uid()` devuelve NULL → `NULL is distinct from <uuid>` es TRUE
-- → la excepción se lanza → el trigger falla → **la creación del usuario se
-- aborta entera** (ni perfil ni cuenta). Es el mismo modo de fallo que ya se
-- sufrió una vez en este sistema. El REVOKE enumerado es el único control
-- real, y no tiene ese riesgo.
--
-- Y por el mismo motivo este archivo NO hace `create or replace` de ninguna
-- seed: reescribir esos cuerpos de ~200 líneas es exactamente la operación que
-- ya los corrompió (incluido el 42P13 `cannot change name of input parameter`
-- al intentar repararlos después).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Seeds y triggers de alta de usuario: nadie los invoca directamente.
-- ------------------------------------------------------------
revoke execute on function public.seed_first_trust_watchlist(uuid)     from public, anon, authenticated;
revoke execute on function public.seed_evolve_universe_watchlist(uuid) from public, anon, authenticated;
revoke execute on function public.seed_pershing_square_watchlist(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user()                    from public, anon, authenticated;
revoke execute on function public.handle_new_user_default_watchlists() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. get_shared_watchlist_ids() — CONSERVAR `authenticated`.
-- ------------------------------------------------------------
-- ⚠️ NO la metas en el REVOKE de arriba. Esta función se evalúa DENTRO de tres
-- políticas RLS (`shared_read_watchlists` sobre watchlists y `shared_read_assets`
-- sobre watchlist_assets, ver supabase/schema.sql:657 y :731). Las expresiones
-- de una política corren con los privilegios del rol que hace la consulta: si
-- `authenticated` pierde EXECUTE, cada SELECT sobre watchlists de un usuario
-- logueado falla con "permission denied for function" y **compartir watchlists
-- deja de funcionar por completo**.
-- `anon` no lo necesita: no hay ninguna lectura anónima de watchlists.
revoke execute on function public.get_shared_watchlist_ids() from public, anon;
grant  execute on function public.get_shared_watchlist_ids() to authenticated, service_role;

-- ------------------------------------------------------------
-- 3. get_top_tickers() — condicional: puede NO existir.
-- ------------------------------------------------------------
-- En el DDL vigente solo aparece COMENTADA (supabase/schema.sql:831) mientras
-- `lib/ai/news-pipeline.ts:111` la invoca. Un grant incondicional abortaría la
-- migración en cualquier entorno donde nunca se creó. Se itera sobre pg_proc
-- por si la firma real difiere de la documentada.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from   pg_proc p
    join   pg_namespace n on n.oid = p.pronamespace
    where  n.nspname = 'public'
      and  p.proname = 'get_top_tickers'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant  execute on function %s to service_role', r.sig);
  end loop;
  -- Si el bucle no itera, la función no existe: el RPC del pipeline de
  -- noticias está roto en producción AHORA (el fallback en código ya filtra
  -- source='user'). Crearla queda fuera del alcance de esta remediación.
end;
$$;

-- ============================================================
-- REVERSIÓN (comentada a propósito)
-- ============================================================
-- Restaura el estado permisivo anterior. Solo tiene sentido si el paso 0.1
-- resultó ser falso (alguna función NO es propiedad de postgres) y el signup
-- se rompió tras aplicar este archivo.
--
-- grant execute on function public.seed_first_trust_watchlist(uuid)     to public;
-- grant execute on function public.seed_evolve_universe_watchlist(uuid) to public;
-- grant execute on function public.seed_pershing_square_watchlist(uuid) to public;
-- grant execute on function public.handle_new_user()                    to public;
-- grant execute on function public.handle_new_user_default_watchlists() to public;
-- grant execute on function public.get_shared_watchlist_ids()           to public;
-- do $$ declare r record; begin
--   for r in select p.oid::regprocedure::text as sig from pg_proc p
--            join pg_namespace n on n.oid = p.pronamespace
--            where n.nspname='public' and p.proname='get_top_tickers'
--   loop execute format('grant execute on function %s to public', r.sig); end loop;
-- end $$;
--
-- Verificación tras aplicar (o tras revertir): repite el paso 0.1 del runbook y
-- compara la columna `proacl` contra el snapshot guardado.
