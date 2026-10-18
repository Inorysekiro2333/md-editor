import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const stubs = vi.hoisted(() => {
  let printImpl: () => Promise<Buffer> = async () => Buffer.from('%PDF-1.4 exporter-test-bytes')
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = []
    loadURL = vi.fn(async (_url: string) => {})
    isDestroyed = (): boolean => false
    destroy = vi.fn()
    webContents = { printToPDF: vi.fn(() => printImpl()) }
    constructor() {
      FakeBrowserWindow.instances.push(this)
    }
  }
  return {
    FakeBrowserWindow,
    setPrintImpl: (impl: () => Promise<Buffer>): void => {
      printImpl = impl
    },
    resetPrintImpl: (): void => {
      printImpl = async () => Buffer.from('%PDF-1.4 exporter-test-bytes')
    },
  }
})

vi.mock('electron', () => ({ BrowserWindow: stubs.FakeBrowserWindow }))

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
    settingsPath = join(dir, 'settings.json')
  })

  it('writes printToPDF bytes to the chosen path and returns it', async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ export: { pdf: { printBackground: true } } }),
      'utf8',
    )
    const target = join(dir, 'out.pdf')

    const result = await exportPdfTo({ targetPath: target, html: '<p>hi</p>', settingsPath })

    expect(result).toBe(target)
    expect(readFileSync(target).toString('latin1')).toBe('%PDF-1.4 exporter-test-bytes')
    const win = lastWindow()
    expect(win.loadURL).toHaveBeenCalledWith(
      expect.stringMatching(/^data:text\/html;charset=utf-8,/),
    )
    const dataUrl = win.loadURL.mock.calls[0]![0] as string
    expect(decodeURIComponent(dataUrl)).toContain('Content-Security-Policy')
    expect(decodeURIComponent(dataUrl)).not.toContain('<script')
    expect(win.webContents.printToPDF).toHaveBeenCalledWith({
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    })
    expect(win.destroy).toHaveBeenCalledTimes(1)
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

  it('destroys the hidden window when printToPDF fails', async () => {
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
  })
})
