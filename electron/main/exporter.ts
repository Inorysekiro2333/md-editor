import { BrowserWindow } from 'electron'
import { writeAtomic } from './fs_io'
import { loadSettings } from './settings'

export interface ExportPdfOptions {
  targetPath: string
  /** Markdown 渲染出的 body HTML 片段（renderer 侧组装，不含远程脚本）。 */
  html?: string
  settingsPath: string
}

const PDF_MARGINS = { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }

/**
 * 组装打印文档：CSP 禁脚本（default-src 'none' 使 script 回退为禁止），
 * 仅放行内联样式与图片。内容来自本仓库 remark 管线，原始 HTML 已在解析层丢弃。
 * 注意：data: URL 有长度上限（~2MB），超大文档待 Task 7 管线时改为临时文件方案。
 */
function buildPrintDocument(html?: string): string {
  const body = typeof html === 'string' && html.length > 0 ? html : '<p></p>'
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8" />',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src * data:; style-src 'unsafe-inline'" />`,
    '</head>',
    `<body>${body}</body>`,
    '</html>',
  ].join('\n')
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
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(buildPrintDocument(html))}`
    await win.loadURL(dataUrl)
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
  }
}
