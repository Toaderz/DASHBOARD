import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// REL-02: cuando @supabase/ssr refresca la sesion entrega cabeceras de cache junto con las cookies.
// El middleware debe copiarlas a la respuesta para que ningun CDN cachee una respuesta con Set-Cookie.
const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  refresh: true,
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (c: unknown[], hdr: Record<string, string>) => void } }) => ({
    auth: {
      getUser: async () => {
        if (h.refresh) {
          opts.cookies.setAll(
            [{ name: 'sb-test-auth-token', value: 'nuevo', options: { path: '/' } }],
            { 'Cache-Control': 'private, no-store', Expires: '0', Pragma: 'no-cache' }
          )
        }
        return { data: { user: h.user } }
      },
    },
  }),
}))

import { updateSession } from '@/lib/supabase/middleware'

const req = (path: string) => new NextRequest(`http://localhost${path}`)

beforeEach(() => {
  h.user = { id: 'u1' }
  h.refresh = true
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-FAKE'
})

describe('REL-02 updateSession', () => {
  it('copia Cache-Control: private, no-store a la respuesta cuando se refrescan las cookies', async () => {
    const res = await updateSession(req('/'))
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('pragma')).toBe('no-cache')
    expect(res.cookies.get('sb-test-auth-token')?.value).toBe('nuevo')
  })
  it('sin refresco de sesion no inventa cabeceras', async () => {
    h.refresh = false
    const res = await updateSession(req('/'))
    expect(res.headers.get('cache-control')).toBeNull()
  })
  it('sin usuario redirige a /login (comportamiento intacto)', async () => {
    h.user = null
    h.refresh = false
    const res = await updateSession(req('/watchlist/abc'))
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })
})
