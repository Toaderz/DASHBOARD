import { NextRequest, NextResponse } from 'next/server'
import { guardApi } from '@/lib/api/guard'
import { getAdminClient } from '@/lib/supabase/admin'
import { normalizeTicker } from '@/lib/market/validation'

const VALID_TYPES = ['stock', 'etf', 'index', 'fund', 'crypto'] as const
const MAX_NAME_LENGTH = 200
const LIMIT_PER_MIN = 120

/**
 * Registra un activo en assets_metadata (necesario por la FK de watchlist_assets). Reemplaza el INSERT
 * directo desde el navegador: la política "auth users insert assets" se elimina en la migración M5.
 * ignoreDuplicates: nunca pisa nombres ya curados.
 */
export async function POST(request: NextRequest) {
  const guard = await guardApi('assets-register', LIMIT_PER_MIN)
  if ('response' in guard) return guard.response

  let body: { ticker?: unknown; name?: unknown; type?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const ticker = normalizeTicker(body.ticker)
  if (!ticker) return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 })

  const type = VALID_TYPES.find((t) => t === body.type)
  if (!type) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const rawName = typeof body.name === 'string' ? body.name.trim() : ''
  const name = (rawName || ticker).slice(0, MAX_NAME_LENGTH)

  let admin
  try {
    admin = getAdminClient()
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const { error } = await admin
    .from('assets_metadata')
    .upsert({ ticker, name, type }, { onConflict: 'ticker', ignoreDuplicates: true })
  if (error) {
    console.error('[assets/register] upsert error:', error.message)
    return NextResponse.json({ error: 'Could not register asset' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, ticker })
}
