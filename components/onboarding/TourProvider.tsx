'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Cada paso ancla a un elemento del DOM vía data-tour. `fallback` se usa cuando
// el ancla principal no existe (p. ej. la grid de overview todavía no montada).
export interface TourStep {
  anchor: string
  fallback?: string
  title: string
  body: string
}

// Pasos del recorrido. En móvil los pasos de navegación colapsan al botón
// hamburguesa (data-tour="mobile-menu") — lo resuelve TourSpotlight.
export const TOUR_STEPS: TourStep[] = [
  {
    anchor: '[data-tour="overview-grid"]',
    fallback: '[data-tour="nav-overview"]',
    title: 'Bienvenido a Evolve',
    body: 'Tu terminal financiera. Te mostramos lo esencial en menos de un minuto.',
  },
  {
    anchor: '[data-tour="nav-watchlists"]',
    title: 'Navegación',
    body: 'Desde aquí saltas entre Overview, Top/Worst Performers, Beating Peers y el Market Brief.',
  },
  {
    anchor: '[data-tour="watchlists"]',
    title: 'Tus watchlists',
    body: 'Crea, renombra y comparte listas. Selecciona una para ver sus activos en tiempo real.',
  },
  {
    anchor: '[data-tour="add-ticker"]',
    fallback: '[data-tour="watchlists"]',
    title: 'Agregar tickers',
    body: 'Busca un símbolo y agrégalo a la lista activa. Los precios se actualizan solos.',
  },
  {
    anchor: '[data-tour="nav-peers"]',
    title: 'Beating Peers',
    body: 'Compara cada activo contra sus pares en 6 periodos y mira a quién le gana.',
  },
  {
    anchor: '[data-tour="nav-news"]',
    title: 'Market Brief',
    body: 'Un resumen semanal del mercado con análisis y señales para tu portafolio.',
  },
  {
    anchor: '[data-tour="marquee"]',
    title: 'Marquee en vivo',
    body: 'Índices y referencias globales corriendo en tiempo real en la parte superior.',
  },
]

interface TourContextValue {
  running: boolean
  stepIndex: number
  steps: TourStep[]
  start: () => void
  next: () => void
  prev: () => void
  skip: () => void
  finish: () => void
}

const TourContext = createContext<TourContextValue | null>(null)

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour debe usarse dentro de <TourProvider>')
  return ctx
}

const LS_KEY = 'evolve_onboarding_seen'

interface TourProviderProps {
  children: React.ReactNode
  // Valor de profiles.onboarding_seen del usuario (server). Si es false y no
  // hay marca en localStorage, el recorrido arranca UNA sola vez.
  onboardingSeen?: boolean
  userId?: string | null
}

export function TourProvider({ children, onboardingSeen = true, userId }: TourProviderProps) {
  const [running, setRunning] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)

  // Auto-arranque único: solo si el server dice que no lo ha visto Y localStorage
  // tampoco lo marca (evita re-disparos aunque el update a Supabase falle).
  useEffect(() => {
    if (onboardingSeen) return
    try {
      if (window.localStorage.getItem(LS_KEY) === 'true') return
    } catch {
      /* localStorage no disponible */
    }
    setStepIndex(0)
    setRunning(true)
  }, [onboardingSeen])

  const start = useCallback(() => {
    setStepIndex(0)
    setRunning(true)
  }, [])

  // Persiste onboarding_seen=true en Supabase + localStorage al terminar/saltar.
  const persistSeen = useCallback(() => {
    try {
      window.localStorage.setItem(LS_KEY, 'true')
    } catch {
      /* noop */
    }
    if (!userId) return
    const supabase = createClient()
    void supabase.from('profiles').update({ onboarding_seen: true }).eq('id', userId)
  }, [userId])

  const end = useCallback(() => {
    setRunning(false)
    setStepIndex(0)
    persistSeen()
  }, [persistSeen])

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i >= TOUR_STEPS.length - 1) {
        end()
        return i
      }
      return i + 1
    })
  }, [end])

  const prev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1))
  }, [])

  const value = useMemo<TourContextValue>(
    () => ({ running, stepIndex, steps: TOUR_STEPS, start, next, prev, skip: end, finish: end }),
    [running, stepIndex, start, next, prev, end]
  )

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}
