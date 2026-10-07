import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  runNewsPipeline: vi.fn(),
  createClient: vi.fn(() => ({})),
}))
vi.mock('@/lib/ai/news-pipeline', () => ({ runNewsPipeline: h.runNewsPipeline }))
vi.mock('@supabase/supabase-js', () => ({ createClient: h.createClient }))

import { POST, GET } from '@/app/api/cron/news-pipeline/route'

const req = (auth?: string) =>
  new NextRequest('http://localhost/api/cron/news-pipeline', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
  })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-FAKE'
  process.env.CRON_SECRET = 'secret-FAKE'
  h.runNewsPipeline.mockResolvedValue({ briefId: 'b1' })
})

describe('SEC-06 /api/cron/news-pipeline', () => {
  it('sin CRON_SECRET falla cerrado (500) aunque llegue "Bearer undefined"', async () => {
    delete process.env.CRON_SECRET
    const res = await POST(req('Bearer undefined'))
    expect(res.status).toBe(500)
    expect(h.runNewsPipeline).not.toHaveBeenCalled()
    expect(h.createClient).not.toHaveBeenCalled()
  })
  it('CRON_SECRET vacío también falla cerrado', async () => {
    process.env.CRON_SECRET = ''
    const res = await POST(req('Bearer '))
    expect(res.status).toBe(500)
    expect(h.runNewsPipeline).not.toHaveBeenCalled()
  })
  it('sin cabecera → 401', async () => {
    expect((await POST(req())).status).toBe(401)
    expect(h.runNewsPipeline).not.toHaveBeenCalled()
  })
  it('secreto incorrecto (de igual o distinta longitud) → 401', async () => {
    expect((await POST(req('Bearer secret-FAKX'))).status).toBe(401)
    expect((await POST(req('Bearer x'))).status).toBe(401)
    expect(h.runNewsPipeline).not.toHaveBeenCalled()
  })
  it('secreto correcto → 200 (POST y GET)', async () => {
    const ok = await POST(req('Bearer secret-FAKE'))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ success: true, briefId: 'b1' })
    expect((await GET(req('Bearer secret-FAKE'))).status).toBe(200)
  })
  it('error del pipeline → 500 genérico, sin filtrar el texto del error', async () => {
    h.runNewsPipeline.mockRejectedValue(new Error('LLM 401: key sk-SECRETO-123 invalid'))
    const res = await POST(req('Bearer secret-FAKE'))
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain('SECRETO')
    expect(JSON.parse(text)).toEqual({ error: 'Pipeline failed' })
  })
})
