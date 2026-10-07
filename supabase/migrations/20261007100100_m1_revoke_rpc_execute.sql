-- M1 · SEC-07 / N-02 · Quitar EXECUTE a anon y authenticated en las seed_* y get_top_tickers
-- Certeza: CONFIRMADO (Anexo A, consulta 2): anon y authenticated pueden ejecutarlas.
--
-- ORDEN: después de M0 y de probar en staging. Independiente del código.
-- Nota técnica: los grants son explícitos a anon y authenticated (ALTER DEFAULT PRIVILEGES de Supabase),
-- así que hay que revocarlos por nombre; revocar solo de PUBLIC no basta.
-- Quién las usa: get_top_tickers() la llama lib/ai/news-pipeline.ts con la service_role (conserva el permiso).
-- Las seed_* las ejecuta handle_new_user_default_watchlists() (trigger, DEFINER); ningún cliente las llama.
-- NO se toca get_shared_watchlist_ids(): las políticas de compartir la ejecutan como el rol del usuario.
--
-- ── PRECHECK (solo lectura): quién puede ejecutar hoy ───────────────────────────────────
--   select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as puede
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   cross join (select rolname from pg_roles where rolname in ('anon','authenticated','service_role')) r
--   where n.nspname = 'public' and (p.proname like 'seed\_%' or p.proname = 'get_top_tickers')
--   order by 1, 2;
--   -- Antes: anon y authenticated = true. Después: false; service_role sigue true.
--
-- ── REVERSA (exacta) ─────────────────────────────────────────────────────────────────────
--   grant execute on function public.seed_first_trust_watchlist(uuid)     to anon, authenticated;
--   grant execute on function public.seed_evolve_universe_watchlist(uuid) to anon, authenticated;
--   grant execute on function public.seed_pershing_square_watchlist(uuid) to anon, authenticated;
--   grant execute on function public.get_top_tickers()                    to anon, authenticated;
--
-- ── POSTCHECK: crear una cuenta de prueba (debe traer 3 listas) y correr el Anexo C, prueba T6 → "Bloqueado".

revoke execute on function public.seed_first_trust_watchlist(uuid)     from public, anon, authenticated;
revoke execute on function public.seed_evolve_universe_watchlist(uuid) from public, anon, authenticated;
revoke execute on function public.seed_pershing_square_watchlist(uuid) from public, anon, authenticated;
revoke execute on function public.get_top_tickers()                    from public, anon, authenticated;
