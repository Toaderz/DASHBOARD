-- ============================================================
-- verify-seed.sql — ¿sigue funcionando la cadena de alta de usuarios?
-- ============================================================
-- Es la comprobación de la invariante I-5 del baseline: **el signup siembra 3
-- watchlists** (First Trust, Evolve Universe, Pershing Square).
--
-- CÓMO SE CORRE
--   Local (CLI):   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/verify-seed.sql
--   Producción:    pega el archivo entero en el SQL Editor de Supabase y ejecútalo.
--
-- CUÁNDO: después de CADA delta que toque profiles, watchlists, watchlist_assets
-- o assets_metadata — es decir, tras 002, 004, 005 y 006. Y siempre que alguien
-- reporte que no puede registrarse.
--
-- ------------------------------------------------------------
-- POR QUÉ TERMINA EN `RAISE EXCEPTION` AUNQUE TODO VAYA BIEN
-- ------------------------------------------------------------
-- Dos razones, las dos necesarias:
--   1. La excepción provoca **ROLLBACK**: el usuario falso que se inserta en
--      `auth.users` no persiste. Nada queda sucio en producción.
--   2. `RAISE NOTICE` **no aparece** en el panel de resultados del SQL Editor de
--      Supabase. `RAISE EXCEPTION` sí. Es la única forma de ver el resultado.
-- Por eso un "error" rojo es la salida NORMAL. Lo que importa es el TEXTO:
--   · empieza por `VERIFY-SEED OK`   → la cadena funciona.
--   · empieza por `VERIFY-SEED FAIL` → está rota; el mensaje dice cómo.
--
-- ------------------------------------------------------------
-- CÓMO LEER UN FALLO
-- ------------------------------------------------------------
--   23503 en `watchlist_assets_asset_ticker_fkey`
--       Una seed inserta un ticker que NO existe en `assets_metadata`
--       (el caso histórico fue `^RUT`). Significa que **el signup está roto
--       ahora mismo**, no que la migración fallara. Cada seed debe insertar sus
--       tickers en assets_metadata (ON CONFLICT DO NOTHING) ANTES de
--       referenciarlos desde watchlist_assets.
--
--   23503 en `watchlist_assets_watchlist_id_fkey`
--       La seed está **corrupta en la base de datos**: su cuerpo perdió el
--       `DECLARE v_watchlist_id` o el `INSERT INTO watchlists ... RETURNING id`,
--       así que v_watchlist_id apunta a un UUID inexistente. La fuente correcta
--       está en `supabase/schema.sql`.
--       ⚠️ Si la versión corrupta se guardó además con el parámetro mal nombrado
--       (`v_watchlist_id` en vez de `p_user_id`), `CREATE OR REPLACE` lanza
--       **42P13** `cannot change name of input parameter`: hay que
--       `DROP FUNCTION seed_<name>_watchlist(uuid);` primero y luego recrearla.
--
--   42501 / "permission denied for function seed_..."
--       Regresión de `003_harden_seed_grants.sql`: alguna función SECURITY
--       DEFINER NO es propiedad de `postgres`, así que el REVOKE sí la alcanzó.
--       Repite el paso 0.1 del runbook y revierte 003.
--
--   watchlists < 3 sin ninguna excepción
--       El trigger `on_profile_created_seed_watchlists` no existe o está
--       deshabilitado (`tgenabled <> 'O'`), o una seed hizo `return` temprano.
-- ============================================================

do $$
declare
  v_user_id     uuid := gen_random_uuid();
  v_email       text := 'verify-seed-' || replace(gen_random_uuid()::text, '-', '') || '@invalid.test';
  v_profiles    int;
  v_watchlists  int;
  v_assets      int;
  v_names       text;
  v_missing     text;
  v_constraint  text;
  v_sqlstate    text;
  v_message     text;
  v_hint        text;
begin
  -- --------------------------------------------------------
  -- 1. Disparar la cadena completa: auth.users → profiles → 3 seeds
  -- --------------------------------------------------------
  begin
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Verify Seed"}'::jsonb,
      now(),
      now()
    );
  exception when others then
    get stacked diagnostics
      v_constraint = constraint_name,
      v_sqlstate   = returned_sqlstate,
      v_message    = message_text;

    v_hint := case
      when v_constraint = 'watchlist_assets_asset_ticker_fkey' then
        'Una seed referencia un ticker que no existe en assets_metadata. EL SIGNUP ESTA ROTO AHORA MISMO. '
        || 'Haz que esa seed inserte sus tickers en assets_metadata (ON CONFLICT DO NOTHING) antes de usarlos.'
      when v_constraint = 'watchlist_assets_watchlist_id_fkey' then
        'La seed esta CORRUPTA en la DB (sin DECLARE v_watchlist_id / sin INSERT INTO watchlists RETURNING id). '
        || 'Fuente correcta en supabase/schema.sql. Si CREATE OR REPLACE da 42P13, DROP FUNCTION seed_<name>_watchlist(uuid) primero.'
      when v_sqlstate = '42501' then
        'Permiso denegado sobre una funcion SECURITY DEFINER: regresion de 003. Alguna no es propiedad de postgres. '
        || 'Repite el paso 0.1 del runbook y revierte 003.'
      when v_sqlstate = '23505' then
        'Colision de unicidad. Si es profiles_email_lower_key, 006 se aplico sobre datos que no estaban normalizados.'
      else
        'Sin diagnostico especifico. Revisa el trigger chain con el paso 0.4 del runbook.'
    end;

    raise exception 'VERIFY-SEED FAIL: sqlstate=% constraint=% message=% | %',
      v_sqlstate, coalesce(v_constraint, '-'), v_message, v_hint;
  end;

  -- --------------------------------------------------------
  -- 2. Contar lo que la cadena produjo
  -- --------------------------------------------------------
  select count(*) into v_profiles   from profiles  where id = v_user_id;
  select count(*) into v_watchlists from watchlists where user_id = v_user_id;

  select coalesce(string_agg(name, ', ' order by name), '(ninguna)')
    into v_names
  from watchlists where user_id = v_user_id;

  select count(*) into v_assets
  from watchlist_assets wa
  join watchlists w on w.id = wa.watchlist_id
  where w.user_id = v_user_id;

  -- Cuáles de las 3 esperadas faltan
  select coalesce(string_agg(expected, ', '), '(ninguna)')
    into v_missing
  from (values ('First Trust'), ('Evolve Universe'), ('Pershing Square')) e(expected)
  where not exists (
    select 1 from watchlists w where w.user_id = v_user_id and w.name = e.expected
  );

  -- --------------------------------------------------------
  -- 3. Veredicto. Siempre por EXCEPTION → siempre ROLLBACK.
  -- --------------------------------------------------------
  if v_profiles = 1 and v_watchlists = 3 and v_missing = '(ninguna)' then
    raise exception 'VERIFY-SEED OK: profiles=% watchlists=% assets=% names=[%] (rollback aplicado, nada persiste)',
      v_profiles, v_watchlists, v_assets, v_names;
  else
    raise exception 'VERIFY-SEED FAIL: profiles=% (esperado 1) watchlists=% (esperado 3) assets=% names=[%] faltan=[%] '
      '| Revisa que el trigger on_profile_created_seed_watchlists exista y este habilitado (tgenabled = ''O'').',
      v_profiles, v_watchlists, v_assets, v_names, v_missing;
  end if;
end;
$$;
