import { describe, expect, it } from 'vitest'
import { THEME_VARIABLES, THEMES } from './themes'
import { themeCss } from './css'

describe('themeCss', () => {
  it('emits every theme variable with its value', () => {
    const css = themeCss('github-dark')
    for (const name of THEME_VARIABLES) {
      expect(css).toContain(`${name}: ${THEMES['github-dark'][name]}`)
    }
  })

  it('styles the body with the theme variables and markdown primitives', () => {
    const css = themeCss('paper-serif')
    expect(css).toMatch(/body\s*{[^}]*--md-bg/)
    expect(css).toContain('code')
    expect(css).toContain('blockquote')
    expect(css).toContain('a')
  })

  it('never emits the same value for different themes', () => {
    expect(themeCss('github-light')).not.toBe(themeCss('github-dark'))
  })
})
