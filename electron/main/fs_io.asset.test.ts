import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { saveAssetFile } from './fs_io'

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
