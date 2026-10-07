-- M0 · N-16 · Restaurar el trigger on_auth_user_created en auth.users
-- Certeza: CONFIRMADO que falta en producción (Anexo A) y que funciona en staging con catálogo completo.
--
-- ORDEN: aplicar PRIMERO (no depende de nada). Una sola vez. Es idempotente.
-- Efecto visible: las cuentas nuevas vuelven a recibir su perfil y las 3 listas por defecto.
--
-- ── PRECHECK 1 (solo lectura): ¿falta el trigger? Debe devolver 0 filas ─────────────────
--   select tgname from pg_trigger
--   where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created' and not tgisinternal;
--
-- ── PRECHECK 2: el Anexo B del reporte debe salir vacío (sin webhooks ni llamadas a red) ─
--
-- ── PRECHECK 3: el catálogo tiene todos los tickers que siembran las 3 listas ──────────
--   Corre este bloque completo. Debe terminar en error con el texto "OK_ROLLBACK: 3 listas, N activos".
--   Si dice FALLA o 23503, el catálogo de producción está incompleto: NO apliques M0.
--   (Inserta un usuario falso y su perfil, y siempre se revierte. No depende de M0.)
--
--   do $$
--   declare u uuid := gen_random_uuid(); wl int; wa int; paso text := 'insert auth.users';
--   begin
--     insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
--       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
--       confirmation_token, recovery_token, email_change_token_new, email_change)
--     values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
--       'precheck_' || replace(u::text,'-','') || '@test.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', '');
--     paso := 'insert profiles (dispara las 3 seeds)';
--     insert into public.profiles (id, email) values (u, 'precheck_' || replace(u::text,'-','') || '@test.invalid')
--     on conflict (id) do nothing;  -- si M0 ya existe, el trigger de auth.users ya creo el perfil
--     select count(*) into wl from public.watchlists where user_id = u;
--     select count(*) into wa from public.watchlist_assets a join public.watchlists w on w.id = a.watchlist_id where w.user_id = u;
--     raise exception 'OK_ROLLBACK: % listas, % activos', wl, wa;
--   exception when others then
--     if sqlerrm like 'OK_ROLLBACK%' then raise; end if;
--     raise exception 'FALLA en [%]: % %', paso, sqlstate, sqlerrm;
--   end $$;
--
-- ── REVERSA (exacta) ─────────────────────────────────────────────────────────────────────
--   drop trigger if exists on_auth_user_created on auth.users;
--
-- ── POSTCHECK: en la app, crear una cuenta de prueba y ver que trae 3 listas. ───────────

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
