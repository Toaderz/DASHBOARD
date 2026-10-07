import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  upsert: vi.fn(),
  createSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: h.createSupabaseClient }))

import { POST } from '@/app/api/assets/register/route'
import { resetRateLimit } from '@/lib/api/rate-limit'

const post = (body: unknown) =>
  new NextRequest('http://localhost/api/assets/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimit()
  h.user = null
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-FAKE'
  h.upsert.mockResolvedValue({ error: null })
  h.createSupabaseClient.mockReturnValue({ from: () => ({ upsert: h.upsert }) })
})

describe('M5 POST /api/assets/register', () => {
  it('sin sesión → 401 y no toca Supabase', async () => {
    const res = await POST(post({ ticker: 'AAPL', name: 'Apple', type: 'stock' }))
    expect(res.status).toBe(401)
    expect(h.createSupabaseClient).not.toHaveBeenCalled()
  })
  it.each([
    ['ticker inválido', { ticker: 'A'.repeat(300), name: 'x', type: 'stock' }],
    ['tipo inválido', { ticker: 'AAPL', name: 'x', type: 'bond' }],
    ['sin tipo', { ticker: 'AAPL', name: 'x' }],
  ])('%s → 400', async (_n, body) => {
    h.user = { id: 'u1' }
    const res = await POST(post(body))
    expect(res.status).toBe(400)
    expect(h.upsert).not.toHaveBeenCalled()
  })
  it('JSON roto → 400', async () => {
    h.user = { id: 'u1' }
    expect((await POST(post('{no'))).status).toBe(400)
  })
  it('petición válida → upsert con la clave de servicio, ignoreDuplicates y ticker normalizado', async () => {
    h.user = { id: 'u1' }
    const res = await POST(post({ ticker: 'aapl', name: '  Apple Inc  ', type: 'stock' }))
    expect(res.status).toBe(200)
    expect(h.createSupabaseClient.mock.calls[0][1]).toBe('service-key-FAKE')
    expect(h.upsert).toHaveBeenCalledWith(
      { ticker: 'AAPL', name: 'Apple Inc', type: 'stock' },
      { onConflict: 'ticker', ignoreDuplicates: true }
    )
  })
  it('nombre larguísimo se recorta; nombre vacío usa el ticker', async () => {
    h.user = { id: 'u1' }
    await POST(post({ ticker: 'AAPL', name: 'x'.repeat(5000), type: 'etf' }))
    expect(h.upsert.mock.calls[0][0].name).toHaveLength(200)
    await POST(post({ ticker: 'MSFT', name: '   ', type: 'stock' }))
    expect(h.upsert.mock.calls[1][0].name).toBe('MSFT')
  })
  it('sin SUPABASE_SERVICE_ROLE_KEY → 500 sin caer a otra clave', async () => {
    h.user = { id: 'u1' }
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const res = await POST(post({ ticker: 'AAPL', name: 'Apple', type: 'stock' }))
    expect(res.status).toBe(500)
    expect(h.createSupabaseClient).not.toHaveBeenCalled()
  })
  it('error de base → 500 genérico, sin filtrar el detalle', async () => {
    h.user = { id: 'u1' }
    h.upsert.mockResolvedValue({ error: { message: 'detalle interno secreto' } })
    const res = await POST(post({ ticker: 'AAPL', name: 'Apple', type: 'stock' }))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secreto')
  })
})
