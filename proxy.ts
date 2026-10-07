import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  // Las rutas /api verifican la sesión ellas mismas (guardApi o su propio Bearer). Pasarlas por
  // updateSession añadía una segunda llamada a Supabase Auth por petición, y la watchlist dispara
  // cientos (ticker × período): duplicaba la latencia de cada una.
  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.next()
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
