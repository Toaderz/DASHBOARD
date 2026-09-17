-- ============================================================
-- verify-rls.sql — tests NEGATIVOS de Row Level Security
-- ============================================================
-- Hermano de `scripts/verify-seed.sql`. Crea DOS usuarios reales (A y B) y
-- comprueba, actuando como cada uno, que A no puede tocar lo de B.
--
-- CÓMO SE CORRE
--   Local (CLI):   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/verify-rls.sql
--   Producción:    pega el archivo entero en el SQL Editor de Supabase.
--   ⚠️ Debe ejecutarse como un rol que pueda `SET ROLE authenticated` e insertar
--   en `auth.users` (en Supabase, `postgres`). NO corras esto desde PostgREST.
--
-- CUÁNDO: después de aplicar 003, 004 y 005. Algunos casos FALLAN a propósito
-- si esos deltas aún no están aplicados — el reporte lo dice caso por caso.
--
-- SALIDA: igual que verify-seed.sql, termina SIEMPRE en `RAISE EXCEPTION` para
-- (1) hacer ROLLBACK de los dos usuarios de prueba y (2) que el texto sea
-- visible en el SQL Editor, donde `RAISE NOTICE` no aparece.
--   · `VERIFY-RLS OK`   → los N casos pasaron.
--   · `VERIFY-RLS FAIL` → el reporte lista cada caso con [ok] o [FAIL].
--
-- ------------------------------------------------------------
-- CÓMO SE SIMULA UN USUARIO
-- ------------------------------------------------------------
-- `auth.uid()` lee `current_setting('request.jwt.claims')::json->>'sub'`. Se fija
-- con `set_config(..., true)` (transaction-local) y se cambia de rol con
-- `set_config('role','authenticated',true)`. Es obligatorio salir de `postgres`:
-- un superusuario (y el owner de la tabla) **salta RLS**, así que sin el SET ROLE
-- todos estos tests pasarían de mentira.
-- ============================================================

do $$
declare
  v_a          uuid := gen_random_uuid();
  v_b          uuid := gen_random_uuid();
  v_wl_a       uuid;
  v_wl_b       uuid;
  v_n          int;
  v_fails      int  := 0;
  v_total      int  := 0;
  v_report     text := '';
  v_denied     boolean;
  v_err        text;
begin
  -- ==========================================================
  -- PREFLIGHT — sin estos grants los tests darían falsos positivos
  -- ==========================================================
  if not has_table_privilege('authenticated', 'public.watchlists', 'SELECT') then
    raise exception 'VERIFY-RLS FAIL (preflight): el rol `authenticated` no tiene GRANT SELECT sobre public.watchlists. '
      'Sin ese grant todo fallaría con 42501 y los tests negativos pasarían POR EL MOTIVO EQUIVOCADO. '
      'Restaura los grants por defecto de Supabase antes de seguir.';
  end if;

  -- ==========================================================
  -- SETUP — dos usuarios reales (dispara la cadena de seeds)
  -- ==========================================================
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_a, 'authenticated', 'authenticated',
     'verify-rls-a-' || replace(v_a::text,'-','') || '@invalid.test', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"User A"}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_b, 'authenticated', 'authenticated',
     'verify-rls-b-' || replace(v_b::text,'-','') || '@invalid.test', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"User B"}'::jsonb, now(), now());

  select id into v_wl_a from watchlists where user_id = v_a order by created_at limit 1;
  select id into v_wl_b from watchlists where user_id = v_b order by created_at limit 1;

  if v_wl_a is null or v_wl_b is null then
    raise exception 'VERIFY-RLS FAIL (setup): la cadena de seeds no creó watchlists. Corre scripts/verify-seed.sql primero.';
  end if;

  -- ==========================================================
  -- Actuar como A
  -- ==========================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- ---- Caso 1: A no lee las watchlists de B --------------------------------
  v_total := v_total + 1;
  select count(*) into v_n from watchlists where user_id = v_b;
  if v_n = 0 then v_report := v_report || E'\n[ok]   1. A no lee watchlists de B';
  else v_fails := v_fails + 1;
       v_report := v_report || format(E'\n[FAIL] 1. A lee %s watchlists de B (esperado 0)', v_n); end if;

  -- ---- Caso 2: A no modifica la watchlist de B -----------------------------
  v_total := v_total + 1;
  update watchlists set name = 'HACKED' where id = v_wl_b;
  get diagnostics v_n = row_count;
  if v_n = 0 then v_report := v_report || E'\n[ok]   2. A no modifica la watchlist de B (0 filas afectadas)';
  else v_fails := v_fails + 1;
       v_report := v_report || format(E'\n[FAIL] 2. A modificó %s filas de la watchlist de B', v_n); end if;

  -- ---- Caso 3: A no borra la watchlist de B --------------------------------
  v_total := v_total + 1;
  delete from watchlists where id = v_wl_b;
  get diagnostics v_n = row_count;
  if v_n = 0 then v_report := v_report || E'\n[ok]   3. A no borra la watchlist de B';
  else v_fails := v_fails + 1;
       v_report := v_report || format(E'\n[FAIL] 3. A borró %s filas de la watchlist de B', v_n); end if;

  -- ---- Caso 4: A no crea una watchlist a nombre de B -----------------------
  v_total := v_total + 1; v_denied := false;
  begin
    insert into watchlists (user_id, name) values (v_b, 'suplantada');
  exception when others then v_denied := true; v_err := sqlstate; end;
  if v_denied then v_report := v_report || E'\n[ok]   4. A no crea watchlists a nombre de B (rechazado por WITH CHECK)';
  else v_fails := v_fails + 1;
       v_report := v_report || E'\n[FAIL] 4. A creó una watchlist con user_id = B'; end if;

  -- ---- Caso 5: A no lee los assets de las watchlists de B ------------------
  v_total := v_total + 1;
  select count(*) into v_n from watchlist_assets where watchlist_id = v_wl_b;
  if v_n = 0 then v_report := v_report || E'\n[ok]   5. A no lee watchlist_assets de B';
  else v_fails := v_fails + 1;
       v_report := v_report || format(E'\n[FAIL] 5. A lee %s assets de la watchlist de B', v_n); end if;

  -- ---- Caso 6: A no crea shares de una watchlist de B ----------------------
  v_total := v_total + 1; v_denied := false;
  begin
    insert into watchlist_shares (watchlist_id, shared_with_user_id) values (v_wl_b, v_a);
  exception when others then v_denied := true; end;
  if v_denied then v_report := v_report || E'\n[ok]   6. A no se auto-comparte una watchlist de B';
  else v_fails := v_fails + 1;
       v_report := v_report || E'\n[FAIL] 6. A creó un share sobre la watchlist de B (¡escalada!)'; end if;

  -- ---- Caso 7: A no puede ejecutar las RPC de seed  [requiere 003] ---------
  v_total := v_total + 1; v_denied := false;
  begin
    perform seed_first_trust_watchlist(v_b);
  exception when others then v_denied := true; end;
  if v_denied then v_report := v_report || E'\n[ok]   7. A no puede ejecutar seed_first_trust_watchlist() [003]';
  else v_fails := v_fails + 1;
       v_report := v_report || E'\n[FAIL] 7. A ejecutó seed_first_trust_watchlist() → falta aplicar 003_harden_seed_grants.sql'; end if;

  -- Las funciones de trigger (`handle_new_user*`) no se pueden invocar
  -- directamente ni con EXECUTE concedido (0A000), así que llamarlas sería un
  -- test que pasa por el motivo equivocado. Se comprueba la ACL directamente.
  v_total := v_total + 1;
  if not has_function_privilege('authenticated', 'public.handle_new_user_default_watchlists()', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.seed_evolve_universe_watchlist(uuid)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.seed_pershing_square_watchlist(uuid)', 'EXECUTE')
  then v_report := v_report || E'\n[ok]   8. `authenticated` no tiene EXECUTE sobre handle_new_user*/seed_* restantes [003]';
  else v_fails := v_fails + 1;
       v_report := v_report || E'\n[FAIL] 8. `authenticated` conserva EXECUTE sobre alguna función de la cadena de alta → falta aplicar 003'; end if;

  -- Control POSITIVO del grant que 003 debe CONSERVAR.
  v_total := v_total + 1;
  if has_function_privilege('authenticated', 'public.get_shared_watchlist_ids()', 'EXECUTE')
  then v_report := v_report || E'\n[ok]   8b. `authenticated` CONSERVA EXECUTE sobre get_shared_watchlist_ids() [003]';
  else v_fails := v_fails + 1;
       v_report := v_report || E'\n[FAIL] 8b. `authenticated` perdió EXECUTE sobre get_shared_watchlist_ids() → compartir watchlists está ROTO'; end if;

  -- ---- Caso 9: A no escribe campos curados de assets_metadata  [requiere 005]
  v_total := v_total + 1; v_denied := false;
  begin
    insert into assets_metadata (ticker, name, type, sector)
    values ('ZZVERIFY', 'Curated write attempt', 'stock', 'Inyectado');
  exception when others then v_denied := true; end;
  if v_denied then v_report := v_report || E'\n[ok]   9. A no escribe assets_metadata.sector [005]';
  else v_fails := v_fails + 1;
       v_report := v_report || E'\n[FAIL] 9. A escribió un campo curado de assets_metadata → falta aplicar 005'; end if;

  -- ---- Caso 10: control POSITIVO — A sí añade un ticker limpio -------------
  -- Si este falla, 005 rompió "añadir activo": es el modo de fallo silencioso
  -- descrito en la cabecera de esa migración.
  v_total := v_total + 1; v_denied := false;
  begin
    insert into assets_metadata (ticker, name, type) values ('zzverify2', 'Clean insert', 'stock');
  exception when others then v_denied := true; v_err := sqlerrm; end;
  if not v_denied then
    select count(*) into v_n from assets_metadata where ticker = 'ZZVERIFY2';
    if v_n = 1 then v_report := v_report || E'\n[ok]  10. A añade un ticker limpio y el trigger lo normaliza a MAYÚSCULAS [005]';
    else v_fails := v_fails + 1;
         v_report := v_report || E'\n[FAIL] 10. El ticker se insertó SIN normalizar → el trigger before insert no está activo'; end if;
  else
    v_fails := v_fails + 1;
    v_report := v_report || format(E'\n[FAIL] 10. A NO pudo añadir un ticker limpio (%s) → "añadir activo" está roto', v_err);
  end if;

  -- ---- Caso 11: A no enumera perfiles arbitrarios  [requiere 004] ----------
  v_total := v_total + 1;
  select count(*) into v_n from profiles where id = v_b;
  if v_n = 0 then v_report := v_report || E'\n[ok]  11. A no lee el perfil de B (sin relación de share) [004]';
  else v_fails := v_fails + 1;
       v_report := v_report || E'\n[FAIL] 11. A lee el perfil de B sin relación → falta aplicar 004_narrow_profiles.sql'; end if;

  -- ---- Caso 12: A no enumera el roster de Team Evolve  [requiere 004] ------
  v_total := v_total + 1;
  select count(*) into v_n from profiles where is_team_evolve = true and id <> v_a;
  if v_n = 0 then v_report := v_report || E'\n[ok]  12. A no enumera el roster de Team Evolve [004]';
  else v_fails := v_fails + 1;
       v_report := v_report || format(E'\n[FAIL] 12. A enumeró %s miembros de Team Evolve → falta 004 (o el roster son contrapartes suyas)', v_n); end if;

  -- ---- Caso 13: control POSITIVO — A sí lee su propio perfil ---------------
  v_total := v_total + 1;
  select count(*) into v_n from profiles where id = v_a;
  if v_n = 1 then v_report := v_report || E'\n[ok]  13. A lee su propio perfil (política "own profile select")';
  else v_fails := v_fails + 1;
       v_report := v_report || E'\n[FAIL] 13. A NO lee su propio perfil → 004 rompió la lectura propia'; end if;

  -- ---- Caso 14/15: controles POSITIVOS de contraparte ----------------------
  -- A comparte SU watchlist con B. A partir de ahí SÍ son contrapartes.
  insert into watchlist_shares (watchlist_id, shared_with_user_id) values (v_wl_a, v_b);

  v_total := v_total + 1;
  select count(*) into v_n from profiles where id = v_b;
  if v_n = 1 then v_report := v_report || E'\n[ok]  14. Tras compartir, A lee el perfil de B (destinatario — useWatchlistAssets.ts:184)';
  else v_fails := v_fails + 1;
       v_report := v_report || E'\n[FAIL] 14. A NO lee el perfil del destinatario → 004 rompió el diálogo de compartir'; end if;

  -- Ahora actuar como B
  perform set_config('request.jwt.claims', json_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);

  v_total := v_total + 1;
  select count(*) into v_n from profiles where id = v_a;
  if v_n = 1 then v_report := v_report || E'\n[ok]  15. B lee el perfil de A (dueño de la lista compartida — useWatchlistAssets.ts:27)';
  else v_fails := v_fails + 1;
       v_report := v_report || E'\n[FAIL] 15. B NO lee el perfil del dueño → 004 rompió el subtexto "de @usuario"'; end if;

  v_total := v_total + 1;
  select count(*) into v_n from watchlists where id = v_wl_a;
  if v_n = 1 then v_report := v_report || E'\n[ok]  16. B lee la watchlist compartida (get_shared_watchlist_ids conserva EXECUTE) [003]';
  else v_fails := v_fails + 1;
       v_report := v_report || E'\n[FAIL] 16. B NO lee la watchlist compartida → 003 revocó EXECUTE de get_shared_watchlist_ids a authenticated'; end if;

  -- ---- Caso 17: B sigue sin ver las OTRAS watchlists de A ------------------
  v_total := v_total + 1;
  select count(*) into v_n from watchlists where user_id = v_a and id <> v_wl_a;
  if v_n = 0 then v_report := v_report || E'\n[ok]  17. B solo ve la watchlist compartida, no el resto de A';
  else v_fails := v_fails + 1;
       v_report := v_report || format(E'\n[FAIL] 17. B ve %s watchlists NO compartidas de A', v_n); end if;

  execute 'reset role';

  -- ==========================================================
  -- Veredicto (siempre por EXCEPTION → ROLLBACK de todo)
  -- ==========================================================
  if v_fails = 0 then
    raise exception 'VERIFY-RLS OK: %/% casos. %', v_total, v_total, v_report;
  else
    raise exception 'VERIFY-RLS FAIL: % de % casos fallaron. %', v_fails, v_total, v_report;
  end if;
end;
$$;
