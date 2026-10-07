import { describe, it, expect } from 'vitest'
import { safeHttpUrl } from '@/lib/utils/url'

describe('N-04 safeHttpUrl', () => {
  it.each([
    ['https://www.reuters.com/markets/a?b=1', 'https://www.reuters.com/markets/a?b=1'],
    ['http://example.com/x', 'http://example.com/x'],
    ['  https://example.com/x  ', 'https://example.com/x'],
    ['HTTPS://Example.com/x', 'https://example.com/x'],
  ])('acepta %j', (input, out) => {
    expect(safeHttpUrl(input)).toBe(out)
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://x.com/abc',
    '//evil.com/x',
    '/relativa',
    'ftp://x.com/a',
    '',
    '   ',
    'no es una url',
  ])('rechaza %j', (input) => {
    expect(safeHttpUrl(input)).toBeUndefined()
  })

  it('rechaza lo que no es string', () => {
    expect(safeHttpUrl(null)).toBeUndefined()
    expect(safeHttpUrl(undefined)).toBeUndefined()
    expect(safeHttpUrl(42)).toBeUndefined()
    expect(safeHttpUrl({})).toBeUndefined()
  })
})
