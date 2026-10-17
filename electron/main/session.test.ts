import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadSession, saveSession } from './session'

const SNAPSHOT = JSON.stringify({
  version: 1,
  savedAt: 1234,
  activePath: 'C:/notes/a.md',
  tabs: [{ path: 'C:/notes/a.md', dirty: true, text: '# hello\n' }],
})

async function tmpFile(name = 'session.json'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'md-editor-session-'))
  return join(dir, name)
}

describe('session save/load', () => {
  it('writes the payload atomically and loads it back', async () => {
    const file = await tmpFile()
    await saveSession(SNAPSHOT, file)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(JSON.parse(SNAPSHOT))
    await expect(loadSession(file)).resolves.toEqual(JSON.parse(SNAPSHOT))
  })

  it('returns null when the snapshot file is missing', async () => {
    const file = await tmpFile()
    await expect(loadSession(file)).resolves.toBeNull()
  })

  it('returns null when the snapshot file is corrupt JSON', async () => {
    const file = await tmpFile()
    await writeFile(file, '{not json', 'utf8')
    await expect(loadSession(file)).resolves.toBeNull()
  })

  it('rejects payloads larger than 5MB without writing the file', async () => {
    const file = await tmpFile()
    const huge = 'x'.repeat(5 * 1024 * 1024 + 1)
    await expect(saveSession(huge, file)).rejects.toThrow()
    await expect(loadSession(file)).resolves.toBeNull()
  })
})
