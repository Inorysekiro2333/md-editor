import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

export const SECURITY_BASELINE = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
} as const

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    title: 'md-editor',
    webPreferences: {
      ...SECURITY_BASELINE,
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
