import { app, BrowserWindow, session } from 'electron'
import { registerIpc, type IpcRegistry } from './ipc'
import { buildCsp } from './security'
import { createMainWindow } from './window'
import { CHANNELS } from '../shared/channels'

const userDataOverride = process.env['MD_EDITOR_USER_DATA']
if (userDataOverride) {
  app.setPath('userData', userDataOverride)
}

let mainWindow: BrowserWindow | null = null
let ipcRegistry: IpcRegistry | null = null

function openPathFromCli(): string | null {
  const index = process.argv.indexOf('--open')
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function installCsp(): void {
  const policy = buildCsp(!app.isPackaged)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
    })
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    installCsp()
    ipcRegistry = registerIpc(() => mainWindow)
    mainWindow = createMainWindow()

    const cliPath = openPathFromCli()
    if (cliPath !== null) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send(CHANNELS.openFile, cliPath)
      })
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
      }
    })
  })

  app.on('before-quit', () => {
    void ipcRegistry?.dispose()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
