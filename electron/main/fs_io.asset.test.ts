import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readAssetFile, saveAssetFile } from './fs_io'

function tmpDoc(): string {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-asset-'))
  const file = join(dir, 'doc.md')
  writeFileSync(file, '# doc\n')
  return file
}

describe('saveAssetFile', () => {
  it('writes assets/<timestamp>-<rand>.<ext> and returns relative path', async () => {
    const docPath = tmpDoc()
    const bytes = Buffer.from([1, 2, 3])
    const rel = await saveAssetFile(docPath, bytes, 'png')
    expect(rel).toMatch(/^assets\/\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]+\.png$/)
    const abs = join(docPath, '..', rel)
    expect(existsSync(abs)).toBe(true)
    expect(readFileSync(abs).equals(bytes)).toBe(true)
  })

  it('rejects non-whitelisted ext without writing', async () => {
    const docPath = tmpDoc()
    await expect(saveAssetFile(docPath, Buffer.from([1]), 'exe')).rejects.toThrow(
      /不支持的图片格式/,
    )
    expect(existsSync(join(docPath, '..', 'assets'))).toBe(false)
  })

  it('rejects empty or nonexistent doc path with a safe message', async () => {
    await expect(saveAssetFile('', Buffer.from([1]), 'png')).rejects.toThrow(/文档路径无效/)
    await expect(
      saveAssetFile(join(tmpdir(), 'md-editor-asset-missing', 'doc.md'), Buffer.from([1]), 'png'),
    ).rejects.toThrow(/文档路径无效/)
  })
})

describe('readAssetFile', () => {
  it('reads a relative image next to the doc and returns base64', async () => {
    const docPath = tmpDoc()
    const dir = join(docPath, '..')
    const bytes = Buffer.from([137, 80, 78, 71])
    writeFileSync(join(dir, 'pic.png'), bytes)
    const file = await readAssetFile(docPath, 'pic.png')
    expect(file.base64).toBe(bytes.toString('base64'))
  })

  it('resolves nested relative paths', async () => {
    const docPath = tmpDoc()
    const dir = join(docPath, '..')
    const bytes = Buffer.from([1, 2, 3])
    const sub = join(dir, 'assets')
    mkdirSync(sub)
    writeFileSync(join(sub, 'a.webp'), bytes)
    const file = await readAssetFile(docPath, 'assets/a.webp')
    expect(file.base64).toBe(bytes.toString('base64'))
  })

  it('rejects remote, absolute, protocol and non-whitelisted paths', async () => {
    const docPath = tmpDoc()
    await expect(readAssetFile(docPath, 'https://example.com/a.png')).rejects.toThrow(/路径无效/)
    await expect(readAssetFile(docPath, '//example.com/a.png')).rejects.toThrow(/路径无效/)
    await expect(readAssetFile(docPath, 'C:\\other\\a.png')).rejects.toThrow(/路径无效/)
    await expect(readAssetFile(docPath, 'data:image/png;base64,AAA')).rejects.toThrow(/路径无效/)
    await expect(readAssetFile(docPath, 'payload.exe')).rejects.toThrow(/不支持的图片格式/)
    await expect(readAssetFile(docPath, 'missing.png')).rejects.toThrow()
  })

  it('rejects an invalid doc path', async () => {
    await expect(readAssetFile('', 'a.png')).rejects.toThrow(/文档路径无效/)
    await expect(
      readAssetFile(join(tmpdir(), 'md-editor-asset-missing', 'doc.md'), 'a.png'),
    ).rejects.toThrow()
  })
})
