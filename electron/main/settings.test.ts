import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadSettings, saveSettings } from './settings'
import { DEFAULT_SETTINGS, mergeSettings } from '../shared/settings'

async function tmpFile(name = 'settings.json'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'md-editor-settings-'))
  return join(dir, name)
}

describe('settings load/save', () => {
  it('persists and restores sidebarCollapsed', async () => {
    const file = await tmpFile()
    const settings = { ...DEFAULT_SETTINGS, sidebarCollapsed: true }
    saveSettings(settings, file)
    expect(loadSettings(file)).toEqual(settings)
  })

  it('mergeSettings whitelists sidebarCollapsed and drops invalid values', () => {
    expect(mergeSettings({ sidebarCollapsed: true, unknown: 1 }).sidebarCollapsed).toBe(true)
    expect(mergeSettings({ sidebarCollapsed: 'yes' }).sidebarCollapsed).toBe(false)
    expect(mergeSettings({}).sidebarCollapsed).toBe(false)
  })
  it('writes atomically and reads the settings back unchanged', async () => {
    const file = await tmpFile()
    saveSettings(DEFAULT_SETTINGS, file)
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS)
    const raw = JSON.parse(await readFile(file, 'utf8'))
    expect(raw).toEqual(DEFAULT_SETTINGS)
  })

  it('returns defaults when the file is missing', async () => {
    const file = await tmpFile()
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS)
  })

  it('returns defaults and does not throw on corrupt JSON', async () => {
    const file = await tmpFile()
    await writeFile(file, '{not json', 'utf8')
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS)
  })

  it('fills missing fields from defaults when the file is partial', async () => {
    const file = await tmpFile()
    await writeFile(file, JSON.stringify({ themeId: 'paper-serif' }), 'utf8')
    expect(loadSettings(file)).toEqual({
      themeId: 'paper-serif',
      sidebarCollapsed: false,
      export: { pdf: { printBackground: true } },
    })
  })
})

describe('mergeSettings whitelist', () => {
  it('keeps only whitelisted fields and coerces invalid values to defaults', () => {
    const merged = mergeSettings({
      themeId: 'github-dark',
      sidebarCollapsed: false,
      unknownTop: 1,
      export: { pdf: { printBackground: false, extra: true }, html: { keep: true } },
    })
    expect(merged).toEqual({
      themeId: 'github-dark',
      sidebarCollapsed: false,
      export: { pdf: { printBackground: false } },
    })
  })

  it('falls back to defaults for invalid themeId or non-boolean printBackground', () => {
    expect(mergeSettings({ themeId: 'solarized' })).toEqual(DEFAULT_SETTINGS)
    expect(mergeSettings({ export: { pdf: { printBackground: 'yes' } } })).toEqual(DEFAULT_SETTINGS)
    expect(mergeSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })
})
