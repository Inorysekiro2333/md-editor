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
      export: { pdf: { printBackground: true } },
    })
  })
})

describe('mergeSettings whitelist', () => {
  it('keeps only whitelisted fields and coerces invalid values to defaults', () => {
    const merged = mergeSettings({
      themeId: 'github-dark',
      unknownTop: 1,
      export: { pdf: { printBackground: false, extra: true }, html: { keep: true } },
    })
    expect(merged).toEqual({
      themeId: 'github-dark',
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
