/**
 * GOLDEN TESTS — `normalizeEventTag` (exported from `lib/ai/news-pipeline.ts`).
 *
 * This function is the grouping key of the hard event-dedup: `selectFinalArticles` keeps only the
 * highest-scoring article per normalised tag. Loosen it and unrelated stories merge (the brief
 * silently loses news); tighten it and the same event slips through five times (the echo chamber
 * the dedup exists to prevent).
 *
 * The file only IMPORTS the pipeline — it never edits it.
 */

import { describe, it, expect } from 'vitest'
import { normalizeEventTag } from './news-pipeline'

describe('normalizeEventTag', () => {
  it('lowercases', () => {
    expect(normalizeEventTag('Fed Rate Decision')).toBe('fed rate decision')
    expect(normalizeEventTag('FED RATE DECISION')).toBe('fed rate decision')
  })

  it('strips accents so Spanish tags collapse onto their ASCII form', () => {
    expect(normalizeEventTag('Decisión de Banxico')).toBe('decision de banxico')
    expect(normalizeEventTag('Inflación núcleo México')).toBe('inflacion nucleo mexico')
    expect(normalizeEventTag('ÁÉÍÓÚÜÑ')).toBe('aeiouun')
  })

  it('replaces punctuation with a space, then collapses the spaces', () => {
    expect(normalizeEventTag('Fed: rate decision (Dec.)')).toBe('fed rate decision dec')
    expect(normalizeEventTag('U.S.-China trade deal')).toBe('u s china trade deal')
    expect(normalizeEventTag('CPI   report,,, 2025')).toBe('cpi report 2025')
  })

  it('keeps digits — they often carry the event identity', () => {
    expect(normalizeEventTag('Q3 2025 earnings')).toBe('q3 2025 earnings')
  })

  it('trims and collapses any whitespace, including tabs and newlines', () => {
    expect(normalizeEventTag('  Fed\trate\ndecision  ')).toBe('fed rate decision')
  })

  it('maps the same event written three different ways onto ONE key', () => {
    const variants = ['Decisión de tasas de la Fed', 'DECISION DE TASAS DE LA FED', 'Decisión, de tasas de la Fed.']
    const keys = new Set(variants.map(normalizeEventTag))
    expect(keys.size).toBe(1)
    expect([...keys][0]).toBe('decision de tasas de la fed')
  })

  it('does NOT merge genuinely different events', () => {
    expect(normalizeEventTag('Fed rate decision')).not.toBe(normalizeEventTag('Banxico rate decision'))
    expect(normalizeEventTag('Nvidia earnings')).not.toBe(normalizeEventTag('Nvidia export ban'))
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   \n\t '],
    ['punctuation only', '---...,,,'],
  ])('returns the empty string for %s', (_label, input) => {
    expect(normalizeEventTag(input as string | null | undefined)).toBe('')
  })

  it('an empty tag is a FALSY key, so callers must not fuse untagged articles', () => {
    // `selectFinalArticles` does `const key = tag || `__unique__:${a.source_url}``. If this
    // function ever returned something truthy (a space, a placeholder) for a missing tag, every
    // untagged article would collapse into one and the brief would shrink to a single story.
    expect(normalizeEventTag(undefined)).toBeFalsy()
    expect(normalizeEventTag('')).toBeFalsy()
    expect(normalizeEventTag('.')).toBeFalsy()
  })

  it('survives non-string input without throwing', () => {
    for (const bad of [42, {}, [], true, Number.NaN]) {
      expect(normalizeEventTag(bad as unknown as string)).toBe('')
    }
  })

  it('is idempotent — normalising twice changes nothing', () => {
    for (const tag of ['Decisión de Banxico', 'Fed: rate decision (Dec.)', 'Q3 2025 earnings', '']) {
      const once = normalizeEventTag(tag)
      expect(normalizeEventTag(once)).toBe(once)
    }
  })
})
