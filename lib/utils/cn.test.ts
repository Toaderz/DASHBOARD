import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils/cn'

// Smoke test: proves the harness resolves the `@` alias and compiles TypeScript.
describe('cn', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('drops falsy values', () => {
    expect(cn('a', false && 'b', undefined, null, 'c')).toBe('a c')
  })

  it('lets the last conflicting tailwind utility win', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})
