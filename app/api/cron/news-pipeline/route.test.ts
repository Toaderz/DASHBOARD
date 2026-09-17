import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The route pulls in the whole news pipeline (Tavily/Firecrawl/LLM chain) and the `server-only`
// service-role module. Both are stubbed: this suite is about the AUTH GATE, nothing else.
vi.mock('server-only', () => ({}))
// `vi.hoisted` because `vi.mock` factories are hoisted above every import.
const { runNewsPipeline } = vi.hoisted(() => ({
  runNewsPipeline: vi.fn(async (): Promise<{ briefId: string } | { skipped: string }> => ({ briefId: 'brief-123' })),
}))
vi.mock('@/lib/ai/news-pipeline', () => ({ runNewsPipeline }))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: () => ({}),
  createCacheClient: () => ({ client: {}, canWrite: true }),
}))

import { POST } from '@/app/api/cron/news-pipeline/route'

const SECRET = 'super-secret-value'
const req = (auth?: string) =>
  new Request('https://example.test/api/cron/news-pipeline', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
  })

let savedSecret: string | undefined

beforeEach(() => {
  savedSecret = process.env.CRON_SECRET
  runNewsPipeline.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = savedSecret
  vi.restoreAllMocks()
})

describe('cron/news-pipeline auth gate', () => {
  it('500s when CRON_SECRET is unset — never 200, never 401', async () => {
    delete process.env.CRON_SECRET
    // The old check compared against `Bearer ${undefined}`, so this exact header AUTHENTICATED.
    const res = await POST(req('Bearer undefined'))
    expect(res.status).toBe(500)
    expect(runNewsPipeline).not.toHaveBeenCalled()
  })

  it('500s when CRON_SECRET is unset even with no Authorization header', async () => {
    delete process.env.CRON_SECRET
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect(runNewsPipeline).not.toHaveBeenCalled()
  })

  it('500s when CRON_SECRET is an empty string', async () => {
    process.env.CRON_SECRET = ''
    const res = await POST(req('Bearer '))
    expect(res.status).toBe(500)
    expect(runNewsPipeline).not.toHaveBeenCalled()
  })

  it('401s on a wrong secret', async () => {
    process.env.CRON_SECRET = SECRET
    const res = await POST(req('Bearer wrong-value'))
    expect(res.status).toBe(401)
    expect(runNewsPipeline).not.toHaveBeenCalled()
  })

  it('401s on a missing header, a bare token and a wrong scheme', async () => {
    process.env.CRON_SECRET = SECRET
    for (const header of [undefined, SECRET, `Basic ${SECRET}`, `bearer ${SECRET}`]) {
      const res = await POST(req(header))
      expect(res.status).toBe(401)
    }
    expect(runNewsPipeline).not.toHaveBeenCalled()
  })

  it('401s on a same-length-but-different secret (constant-time path still rejects)', async () => {
    process.env.CRON_SECRET = SECRET
    const wrong = 'x'.repeat(SECRET.length)
    expect(wrong).toHaveLength(SECRET.length)
    const res = await POST(req(`Bearer ${wrong}`))
    expect(res.status).toBe(401)
  })

  it('200s and runs the pipeline on the correct secret', async () => {
    process.env.CRON_SECRET = SECRET
    const res = await POST(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, briefId: 'brief-123' })
    expect(runNewsPipeline).toHaveBeenCalledTimes(1)
  })

  it('returns a generic error with a correlation id, never the raw error', async () => {
    process.env.CRON_SECRET = SECRET
    runNewsPipeline.mockRejectedValueOnce(new Error('postgres://user:pw@host exploded'))
    const res = await POST(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string; cid: string }
    expect(body.error).toBe('Pipeline failed')
    expect(body.cid).toBeTruthy()
    expect(JSON.stringify(body)).not.toContain('postgres')
  })
})
