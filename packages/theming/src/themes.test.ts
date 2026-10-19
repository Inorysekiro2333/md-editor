// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { THEME_IDS, THEMES, THEME_VARIABLES } from './themes'
import { applyTheme } from './apply'

const MD_VARIABLES = [
  '--md-bg',
  '--md-fg',
  '--md-accent',
  '--md-border',
  '--md-code-bg',
  '--md-font-serif',
] as const

const UI_VARIABLES = [
  '--ui-bg',
  '--ui-surface',
  '--ui-surface-hover',
  '--ui-fg',
  '--ui-fg-muted',
  '--ui-border',
  '--ui-accent',
  '--ui-accent-fg',
  '--ui-danger',
] as const

describe('builtin themes', () => {
  it('covers exactly the three builtin theme ids', () => {
    expect(THEME_IDS).toEqual(['github-light', 'github-dark', 'paper-serif'])
    expect(Object.keys(THEMES)).toEqual(['github-light', 'github-dark', 'paper-serif'])
  })

  it('uses the same CSS variable key set in every theme', () => {
    for (const id of THEME_IDS) {
      expect(Object.keys(THEMES[id]).sort()).toEqual([...THEME_VARIABLES].sort())
    }
  })

  it('defines exactly 15 variables: 6 doc-layer and 9 chrome-layer tokens', () => {
    expect(THEME_VARIABLES).toHaveLength(15)
    for (const name of MD_VARIABLES) {
      expect(THEME_VARIABLES).toContain(name)
    }
    for (const name of UI_VARIABLES) {
      expect(THEME_VARIABLES).toContain(name)
    }
  })

  it('requires the core variables', () => {
    const required = ['--md-bg', '--md-fg', '--md-accent', '--md-border', '--md-code-bg'] as const
    for (const id of THEME_IDS) {
      for (const name of required) {
        expect(THEMES[id][name], `${id} missing ${name}`).toBeTruthy()
      }
    }
  })

  it('defines every chrome-layer ui token as a hex color', () => {
    for (const id of THEME_IDS) {
      for (const name of UI_VARIABLES) {
        expect(THEMES[id][name], `${id} missing ${name}`).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('defines a serif font variable for every theme', () => {
    for (const id of THEME_IDS) {
      expect(THEMES[id]['--md-font-serif']).toBeTruthy()
    }
  })
})

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.cssText = ''
  })

  it('sets data-theme and core CSS variables on the document root', () => {
    applyTheme('github-dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('github-dark')
    const style = document.documentElement.style
    expect(style.getPropertyValue('--md-bg')).toBe(THEMES['github-dark']['--md-bg'])
    expect(style.getPropertyValue('--md-fg')).toBe(THEMES['github-dark']['--md-fg'])
    expect(style.getPropertyValue('--md-accent')).toBe(THEMES['github-dark']['--md-accent'])
  })

  it('applies chrome-layer ui tokens to the document root', () => {
    applyTheme('paper-serif')
    const style = document.documentElement.style
    expect(style.getPropertyValue('--ui-bg')).toBe(THEMES['paper-serif']['--ui-bg'])
    expect(style.getPropertyValue('--ui-fg')).toBe(THEMES['paper-serif']['--ui-fg'])
    expect(style.getPropertyValue('--ui-accent')).toBe(THEMES['paper-serif']['--ui-accent'])
  })

  it('covers every variable key when switching themes', () => {
    applyTheme('github-light')
    applyTheme('paper-serif')
    expect(document.documentElement.getAttribute('data-theme')).toBe('paper-serif')
    for (const name of THEME_VARIABLES) {
      expect(document.documentElement.style.getPropertyValue(name)).toBe(
        THEMES['paper-serif'][name],
      )
    }
  })
})
