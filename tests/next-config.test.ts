import { describe, it, expect } from 'vitest'
import config from '../next.config'

describe('REL-05 next.config', () => {
  it('el optimizador de imágenes no acepta ningún host remoto', () => {
    const patterns = (config as { images?: { remotePatterns?: unknown[] } }).images?.remotePatterns ?? []
    expect(patterns).toEqual([])
  })
})
