import { app, BrowserWindow, session } from 'electron'
import { writeFileSync } from 'node:fs'
import { registerIpc, type IpcRegistry } from './ipc'
import { buildCsp } from './security'
import { confirmWindowClose, createMainWindow, markQuitting } from './window'
import { CHANNELS } from '../shared/channels'

const STARTED_AT = Date.now()

function probeMemoryPathFromCli(): string | null {
  const index = process.argv.indexOf('--probe-memory')
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

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

function openDirFromCli(): string | null {
  const index = process.argv.indexOf('--open-dir')
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
    const closeGuardEnabled = process.env.MD_EDITOR_NO_CLOSE_GUARD !== '1'
    ipcRegistry = registerIpc(() => mainWindow, confirmWindowClose)
    mainWindow = createMainWindow(closeGuardEnabled)
    mainWindow.once('ready-to-show', () => {
      console.log(`[startup] ready ${Date.now() - STARTED_AT}`)
      const probePath = probeMemoryPathFromCli()
      if (probePath !== null) {
        writeFileSync(probePath, JSON.stringify(app.getAppMetrics(), null, 2))
        app.quit()
      }
    })

    const cliPath = openPathFromCli()
    if (cliPath !== null) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send(CHANNELS.openFile, cliPath)
      })
    }

    const cliDir = openDirFromCli()
    if (cliDir !== null) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send(CHANNELS.openWorkspace, cliDir)
      })
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(closeGuardEnabled)
      }
    })
  })

  app.on('before-quit', () => {
    markQuitting()
    void ipcRegistry?.dispose()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
