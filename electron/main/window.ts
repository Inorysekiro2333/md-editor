import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { CHANNELS } from '../shared/channels'

export const SECURITY_BASELINE = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
} as const

let closeAllowed = false
let quitting = false
let windowRef: BrowserWindow | null = null

/** app.quit() 前置调用：退出流程不再走 dirty 关窗守卫。 */
export function markQuitting(): void {
  quitting = true
}

/** renderer 确认放弃更改后调用：放行下一次 close。 */
export function confirmWindowClose(): void {
  closeAllowed = true
  windowRef?.close()
}

export function createMainWindow(closeGuardEnabled: boolean): BrowserWindow {
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
  windowRef = window

  window.once('ready-to-show', () => window.show())

  if (closeGuardEnabled) {
    window.on('close', (event) => {
      if (closeAllowed || quitting) {
        closeAllowed = false
        return
      }
      event.preventDefault()
      void window.webContents.send(CHANNELS.closeGuardRequest)
    })
  }

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
