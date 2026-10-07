-- M3 · SEC-09 · Un solo perfil por correo (sin distinguir mayúsculas)
-- Certeza: el precheck de duplicados dio 0 filas (CONFIRMADO por Alejandro, 2026-10-07).
--
-- ORDEN: después de M0. Independiente del código. Si el precheck devuelve filas, NO aplicar.
-- Nota: /api/users/find busca con .eq('email', correo en minúsculas); el índice no cambia ese comportamiento.
--
-- ── PRECHECK (debe devolver 0 filas) ─────────────────────────────────────────────────────
--   select lower(email) as email, count(*) from public.profiles
--   where email is not null group by lower(email) having count(*) > 1;
--
-- ── REVERSA (exacta) ─────────────────────────────────────────────────────────────────────
--   drop index if exists public.profiles_email_lower_key;
--
-- ── POSTCHECK: insertar el mismo correo con otra capitalización debe fallar con 23505 (probar en staging).

create unique index if not exists profiles_email_lower_key
  on public.profiles (lower(email))
  where email is not null;
