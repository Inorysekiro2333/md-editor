// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { THEME_IDS, THEMES, THEME_VARIABLES } from './themes'
import { applyTheme } from './apply'

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

  it('requires the core variables', () => {
    const required = ['--md-bg', '--md-fg', '--md-accent', '--md-border', '--md-code-bg'] as const
    for (const id of THEME_IDS) {
      for (const name of required) {
        expect(THEMES[id][name], `${id} missing ${name}`).toBeTruthy()
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
