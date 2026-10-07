import type { NextConfig } from 'next'
import withSerwistInit from '@serwist/next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['yahoo-finance2', '@tavily/core', 'firecrawl'],
  // La app no usa next/image con hosts remotos. Con la lista vacía el optimizador rechaza
  // cualquier URL externa (antes aceptaba cualquier host https → SSRF, ver auditoría REL-05).
  images: {
    remotePatterns: [],
  },
}

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  register: true,
  disable: process.env.NODE_ENV === 'development',
})

export default withSerwist(nextConfig)
