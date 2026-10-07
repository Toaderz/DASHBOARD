import { describe, it, expect } from 'vitest'
import config from '../next.config'

type Cfg = {
  images?: { remotePatterns?: unknown[] }
  headers?: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>
}

describe('REL-05 next.config', () => {
  it('el optimizador de imágenes no acepta ningún host remoto', () => {
    const patterns = (config as Cfg).images?.remotePatterns ?? []
    expect(patterns).toEqual([])
  })

  it('aplica cabeceras de seguridad a todas las rutas', async () => {
    const rules = await (config as Cfg).headers!()
    const all = rules.find((r) => r.source === '/:path*')!
    const h = Object.fromEntries(all.headers.map((x) => [x.key, x.value]))
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(h['Permissions-Policy']).toContain('camera=()')
    expect(h['Strict-Transport-Security']).toMatch(/max-age=\d+/)
  })

  it('la CSP va en modo solo-reporte (no bloquea) y cierra lo esencial', async () => {
    const rules = await (config as Cfg).headers!()
    const keys = rules[0].headers.map((x) => x.key)
    expect(keys).toContain('Content-Security-Policy-Report-Only')
    expect(keys).not.toContain('Content-Security-Policy')
    const csp = rules[0].headers.find((x) => x.key === 'Content-Security-Policy-Report-Only')!.value
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain('https://*.supabase.co')
  })
})
