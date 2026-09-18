import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Autorización de `POST /api/watchlists/[id]/share-team`.
 *
 * La propiedad que hay que demostrar no es "un extraño recibe 404", sino que ese 404
 * cuesta CERO: no se enumera el roster y no se inserta ningún share. Por eso el roster
 * y el insert son espías y las aserciones van sobre los espías, no solo sobre el status.
 *
 * Por qué existe este archivo: el pase de `security-review` encontró que la ruta
 * comprobaba solo la PROPIEDAD de la watchlist. Eso la volvía auto-otorgable — un
 * usuario de fuera del equipo pulsaba el botón sobre su propia watchlist, el insert le
 * convertía en contraparte de share de todos los miembros y la política
 * `share_counterpart_read_profiles` (004) le abría el roster que 004 cierra.
 */

vi.mock('server-only', () => ({}))

const { getUser, adminFrom, upsert } = vi.hoisted(() => ({
  getUser: vi.fn(),
  adminFrom: vi.fn(),
  upsert: vi.fn(async () => ({ data: [{ id: 's1' }, { id: 's2' }], error: null })),
}))

// Filas que cada test manipula: dueño de la watchlist, flag del llamante, roster.
const db = vi.hoisted(() => ({
  watchlist: null as { id: string; user_id: string } | null,
  caller: null as { is_team_evolve: boolean } | null,
  team: [] as Array<{ id: string }>,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser } }),
}))

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      adminFrom(table)
      if (table === 'watchlists') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.watchlist, error: null }) }) }) }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            // Lectura del propio perfil del llamante: .eq().maybeSingle()
            eq: (_c: string, _v: string) => ({
              maybeSingle: async () => ({ data: db.caller, error: null }),
              // Enumeración del roster: .eq('is_team_evolve', true).neq('id', …)
              neq: async () => ({ data: db.team, error: null }),
            }),
          }),
        }
      }
      if (table === 'watchlist_shares') {
        return { upsert: () => ({ select: upsert }) }
      }
      throw new Error(`tabla inesperada: ${table}`)
    },
  }),
}))

const { POST } = await import('./route')

const OWNER = '11111111-1111-4111-8111-111111111111'
const WATCHLIST = '22222222-2222-4222-8222-222222222222'
const params = (id = WATCHLIST) => ({ params: Promise.resolve({ id }) })

/** El roster solo se enumera con `.neq`, así que su ausencia se mide por el upsert + las tablas tocadas. */
const rosterWasRead = () => adminFrom.mock.calls.filter(([t]) => t === 'profiles').length > 1

beforeEach(() => {
  vi.clearAllMocks()
  db.watchlist = { id: WATCHLIST, user_id: OWNER }
  db.caller = { is_team_evolve: true }
  db.team = [{ id: 'm1' }, { id: 'm2' }]
  getUser.mockResolvedValue({ data: { user: { id: OWNER } } })
})

describe('share-team — autorización', () => {
  it('anónimo → 401 sin tocar la DB', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(new Request('http://t'), params())
    expect(res.status).toBe(401)
    expect(adminFrom).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('uuid inválido → 404 sin tocar la DB', async () => {
    const res = await POST(new Request('http://t'), params('no-es-uuid'))
    expect(res.status).toBe(404)
    expect(adminFrom).not.toHaveBeenCalled()
  })

  it('watchlist de otro → 404 y NO enumera el roster ni inserta', async () => {
    db.watchlist = { id: WATCHLIST, user_id: 'otro-usuario' }
    const res = await POST(new Request('http://t'), params())
    expect(res.status).toBe(404)
    expect(rosterWasRead()).toBe(false)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('watchlist inexistente → el MISMO 404 (no filtra existencia)', async () => {
    db.watchlist = null
    const res = await POST(new Request('http://t'), params())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Watchlist no encontrada' })
    expect(upsert).not.toHaveBeenCalled()
  })

  // ── El hallazgo de security-review ─────────────────────────────────────────
  it('🚩 dueño que NO es de Team Evolve → 404 y CERO shares insertados', async () => {
    db.caller = { is_team_evolve: false }
    const res = await POST(new Request('http://t'), params())
    expect(res.status).toBe(404)
    // Lo que de verdad importa: sin insert no hay contraparte de share, así que la
    // política de 004 no le abre ningún perfil del equipo.
    expect(upsert).not.toHaveBeenCalled()
  })

  it('🚩 el 404 de no-miembro es indistinguible del de watchlist ajena', async () => {
    db.caller = { is_team_evolve: false }
    const noMember = await POST(new Request('http://t'), params())
    db.caller = { is_team_evolve: true }
    db.watchlist = { id: WATCHLIST, user_id: 'otro-usuario' }
    const notMine = await POST(new Request('http://t'), params())
    expect(noMember.status).toBe(notMine.status)
    expect(await noMember.json()).toEqual(await notMine.json())
  })

  it('llamante sin fila de perfil → falla CERRADO (404, sin insert)', async () => {
    db.caller = null
    const res = await POST(new Request('http://t'), params())
    expect(res.status).toBe(404)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('miembro y dueño → inserta y devuelve SOLO el conteo', async () => {
    const res = await POST(new Request('http://t'), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 2 })
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('equipo vacío → count 0 sin insertar', async () => {
    db.team = []
    const res = await POST(new Request('http://t'), params())
    expect(await res.json()).toEqual({ count: 0 })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('la respuesta nunca incluye ids, emails ni el tamaño del equipo', async () => {
    const res = await POST(new Request('http://t'), params())
    const body = await res.json()
    expect(Object.keys(body)).toEqual(['count'])
  })
})
