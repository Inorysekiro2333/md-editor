import { app, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { writeAtomic } from './fs_io'
import { loadSettings } from './settings'

export interface ExportPdfOptions {
  targetPath: string
  /** buildStandaloneHtml 产出的完整自包含 HTML（含 CSP，无脚本）。 */
  html?: string
  settingsPath: string
}

const PDF_MARGINS = { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }

const FALLBACK_DOCUMENT = [
  '<!doctype html>',
  '<html>',
  '<head>',
  '<meta charset="utf-8" />',
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src * data:; style-src 'unsafe-inline'" />`,
  '</head>',
  '<body><p></p></body>',
  '</html>',
].join('\n')

/**
 * PDF 打印走临时 .html 文件（userData/tmp）+ loadFile：
 * data: URL 有 ~2MB 长度上限，大文档会被静默截断；
 * 用完即删，不留临时文件。
 */
async function writeTempPrintDocument(html?: string): Promise<string> {
  const document = typeof html === 'string' && html.length > 0 ? html : FALLBACK_DOCUMENT
  const tmpDir = join(app.getPath('userData'), 'tmp')
  await fs.mkdir(tmpDir, { recursive: true })
  const tmpFile = join(tmpDir, `print-${Date.now()}-${randomBytes(6).toString('hex')}.html`)
  await fs.writeFile(tmpFile, document, 'utf8')
  return tmpFile
}

export async function exportPdfTo({
  targetPath,
  html,
  settingsPath,
}: ExportPdfOptions): Promise<string> {
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error('invalid path')
  }
  const settings = loadSettings(settingsPath)
  const tmpFile = await writeTempPrintDocument(html)
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  try {
    await win.loadFile(tmpFile)
    const bytes = await win.webContents.printToPDF({
      printBackground: settings.export.pdf.printBackground,
      margins: PDF_MARGINS,
    })
    await writeAtomic(targetPath, bytes)
    return targetPath
  } finally {
    if (!win.isDestroyed()) {
      win.destroy()
    }
    await fs.rm(tmpFile, { force: true })
  }
}
