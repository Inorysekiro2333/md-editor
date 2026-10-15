import { describe, expect, it } from 'vitest'
import { buildCsp } from './security'

describe('buildCsp', () => {
  it('never allows unsafe-eval', () => {
    expect(buildCsp(true)).not.toContain('unsafe-eval')
    expect(buildCsp(false)).not.toContain('unsafe-eval')
  })

  it('keeps the production policy free of dev-only privileges', () => {
    const prod = buildCsp(false)
    expect(prod).toContain("script-src 'self'")
    expect(prod).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(prod).not.toContain('localhost')
  })

  it('allows vite hmr websockets only in development', () => {
    expect(buildCsp(true)).toContain('ws://localhost:*')
    expect(buildCsp(false)).not.toContain('ws://localhost:*')
  })
})
