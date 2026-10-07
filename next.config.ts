import type { NextConfig } from 'next'
import withSerwistInit from '@serwist/next'

const isDev = process.env.NODE_ENV === 'development'

// REL-05: CSP en modo SOLO-REPORTE. No bloquea nada: el navegador anota en la consola cada recurso que
// la politica habria bloqueado. Cuando pasen unas semanas sin avisos legitimos se cambia el nombre de la
// cabecera a `Content-Security-Policy` para aplicarla.
// 'unsafe-inline' en script-src es necesario hoy porque Next.js inyecta scripts en linea; endurecerlo
// exige nonces (proxy.ts) y es una segunda fase.
// img-src admite https: porque los articulos del brief traen imagenes de los medios (NewsCard).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'Content-Security-Policy-Report-Only', value: csp },
]

const nextConfig: NextConfig = {
  serverExternalPackages: ['yahoo-finance2', '@tavily/core', 'firecrawl'],
  // La app no usa next/image con hosts remotos. Con la lista vacía el optimizador rechaza
  // cualquier URL externa (antes aceptaba cualquier host https → SSRF, ver auditoría REL-05).
  images: {
    remotePatterns: [],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  register: true,
  disable: isDev,
})

export default withSerwist(nextConfig)
