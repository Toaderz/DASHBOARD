import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['yahoo-finance2'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
}

export default nextConfig
