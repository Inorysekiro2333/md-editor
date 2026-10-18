import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const stubs = vi.hoisted(() => {
  let printImpl: () => Promise<Buffer> = async () => Buffer.from('%PDF-1.4 exporter-test-bytes')
  const paths = { userData: '', loadedFile: '', loadedHtml: '' }
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = []
    loadFile = vi.fn(async (file: string) => {
      paths.loadedFile = file
      paths.loadedHtml = readFileSync(file, 'utf8')
    })
    isDestroyed = (): boolean => false
    destroy = vi.fn()
    webContents = { printToPDF: vi.fn(() => printImpl()) }
    constructor() {
      FakeBrowserWindow.instances.push(this)
    }
  }
  return {
    FakeBrowserWindow,
    paths,
    setPrintImpl: (impl: () => Promise<Buffer>): void => {
      printImpl = impl
    },
    resetPrintImpl: (): void => {
      printImpl = async () => Buffer.from('%PDF-1.4 exporter-test-bytes')
    },
  }
})

vi.mock('electron', () => ({
  BrowserWindow: stubs.FakeBrowserWindow,
  app: { getPath: () => stubs.paths.userData },
}))

import { exportPdfTo } from './exporter'

const lastWindow = (): InstanceType<typeof stubs.FakeBrowserWindow> => {
  const win = stubs.FakeBrowserWindow.instances.at(-1)
  if (win === undefined) throw new Error('no window created')
  return win
}

describe('exportPdfTo (printToPDF)', () => {
  let dir: string
  let settingsPath: string

  beforeEach(() => {
    stubs.FakeBrowserWindow.instances.length = 0
    stubs.resetPrintImpl()
    dir = mkdtempSync(join(tmpdir(), 'md-editor-exporter-'))
    stubs.paths.userData = join(dir, 'userdata')
    stubs.paths.loadedFile = ''
    stubs.paths.loadedHtml = ''
    settingsPath = join(dir, 'settings.json')
  })

  it('loads a temporary html file under userData and cleans it up', async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ export: { pdf: { printBackground: true } } }),
      'utf8',
    )
    const target = join(dir, 'out.pdf')

    const result = await exportPdfTo({
      targetPath: target,
      html:
        '<!doctype html><html><head>' +
        '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;" />' +
        '</head><body><p>hi</p></body></html>',
      settingsPath,
    })

    expect(result).toBe(target)
    expect(readFileSync(target).toString('latin1')).toBe('%PDF-1.4 exporter-test-bytes')
    const win = lastWindow()
    expect(win.loadFile).toHaveBeenCalledTimes(1)
    expect(stubs.paths.loadedFile).toMatch(
      new RegExp(`^${stubs.paths.userData.replace(/\\/g, '\\\\')}.+\\.html$`),
    )
    // 临时文档带 CSP 禁脚本，打印后即删除
    expect(stubs.paths.loadedHtml).toContain('Content-Security-Policy')
    expect(stubs.paths.loadedHtml).toContain('default-src')
    expect(stubs.paths.loadedHtml).not.toContain('<script')
    expect(existsSync(stubs.paths.loadedFile)).toBe(false)
    expect(win.webContents.printToPDF).toHaveBeenCalledWith({
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    })
    expect(win.destroy).toHaveBeenCalledTimes(1)
  })

  it('falls back to an empty paragraph document when no html is provided', async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ export: { pdf: { printBackground: true } } }),
      'utf8',
    )
    const target = join(dir, 'out.pdf')

    await exportPdfTo({ targetPath: target, settingsPath })

    expect(stubs.paths.loadedHtml).toContain('<p></p>')
  })

  it('reads printBackground from settings (false)', async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ export: { pdf: { printBackground: false } } }),
      'utf8',
    )
    const target = join(dir, 'out.pdf')

    await exportPdfTo({ targetPath: target, html: '<p>hi</p>', settingsPath })

    expect(lastWindow().webContents.printToPDF).toHaveBeenCalledWith(
      expect.objectContaining({ printBackground: false }),
    )
  })

  it('rejects an invalid target path without printing or writing', async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ export: { pdf: { printBackground: true } } }),
      'utf8',
    )
    const target = join(dir, 'out.pdf')

    await expect(exportPdfTo({ targetPath: '', html: '<p>hi</p>', settingsPath })).rejects.toThrow(
      'invalid path',
    )
    await expect(
      exportPdfTo({ targetPath: 42 as unknown as string, html: '<p>hi</p>', settingsPath }),
    ).rejects.toThrow('invalid path')

    expect(stubs.FakeBrowserWindow.instances).toHaveLength(0)
    expect(existsSync(target)).toBe(false)
  })

  it('destroys the hidden window and cleans the temp file when printToPDF fails', async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ export: { pdf: { printBackground: true } } }),
      'utf8',
    )
    const target = join(dir, 'out.pdf')
    stubs.setPrintImpl(async () => {
      throw new Error('print failed')
    })

    await expect(
      exportPdfTo({ targetPath: target, html: '<p>hi</p>', settingsPath }),
    ).rejects.toThrow('print failed')
    expect(lastWindow().destroy).toHaveBeenCalledTimes(1)
    expect(existsSync(target)).toBe(false)
    if (stubs.paths.loadedFile !== '') {
      expect(existsSync(stubs.paths.loadedFile)).toBe(false)
    }
  })
})
