import type { Metadata, Viewport } from 'next'
import { Fraunces, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google'
import { Providers } from '@/components/providers'
import './globals.css'

const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-editorial', display: 'swap' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-ui', display: 'swap' })

export const metadata: Metadata = {
  title: 'Evolve Dashboard',
  description: 'Professional multi-user financial tracking dashboard',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Evolve',
  },
}

export const viewport: Viewport = {
  themeColor: '#09090b',
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={[fraunces.variable, jetbrains.variable, jakarta.variable].join(' ')}>
      <body className="font-ui">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
