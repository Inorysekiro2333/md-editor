import { mkdtemp, readFile as readRaw, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readFile, writeAtomic } from './fs_io'

async function fixtureDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'md-editor-fs-'))
}

describe('readFile', () => {
  it('reads utf-8 without BOM and detects lf', async () => {
    const dir = await fixtureDir()
    const file = join(dir, 'doc.md')
    await writeFile(file, '# hi\n')

    const content = await readFile(file)

    expect(content.text).toBe('# hi\n')
    expect(content.eol).toBe('lf')
    expect(content.hasBom).toBe(false)
    expect(Buffer.from(content.base64, 'base64').toString('utf8')).toBe('# hi\n')
  })

  it('strips BOM from text but keeps the original bytes in base64', async () => {
    const dir = await fixtureDir()
    const file = join(dir, 'doc.md')
    const raw = Buffer.from('\uFEFF# hi\r\n', 'utf8')
    await writeFile(file, raw)

    const content = await readFile(file)

    expect(content.text).toBe('# hi\r\n')
    expect(content.eol).toBe('crlf')
    expect(content.hasBom).toBe(true)
    expect(Buffer.from(content.base64, 'base64').equals(raw)).toBe(true)
  })

  it('rejects invalid utf-8 instead of silently replacing bytes', async () => {
    const dir = await fixtureDir()
    const file = join(dir, 'gbk.md')
    await writeFile(file, Buffer.from([0xb0, 0xa1]))

    await expect(readFile(file)).rejects.toThrow(/utf-8/i)
  })
})

describe('writeAtomic', () => {
  it('writes bytes verbatim and returns a credential matching the file on disk', async () => {
    const dir = await fixtureDir()
    const file = join(dir, 'doc.md')
    const raw = Buffer.from('\uFEFF# 标题\r\n', 'utf8')

    const credential = await writeAtomic(file, raw)
    const written = await readRaw(file)
    const info = await stat(file)

    expect(written.equals(raw)).toBe(true)
    expect(credential.path).toBe(file)
    expect(credential.size).toBe(info.size)
    expect(Math.abs(credential.mtimeMs - info.mtimeMs)).toBeLessThan(1)
  })

  it('replaces an existing file and never leaves a tmp file behind', async () => {
    const dir = await fixtureDir()
    const file = join(dir, 'doc.md')
    await writeFile(file, 'old')

    await writeAtomic(file, Buffer.from('new'))

    expect((await readRaw(file)).toString('utf8')).toBe('new')
    await expect(stat(`${file}.tmp`)).rejects.toThrow()
  })
})
