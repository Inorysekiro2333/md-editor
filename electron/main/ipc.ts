import { ipcMain, type BrowserWindow } from 'electron'
import type { FSWatcher } from 'chokidar'
import { CHANNELS } from '../shared/channels'
import { readFile, writeAtomic, type WriteCredential } from './fs_io'
import { createFileWatcher } from './watcher'

export interface IpcRegistry {
  dispose(): Promise<void>
}

export function registerIpc(getWindow: () => BrowserWindow | null): IpcRegistry {
  let credential: WriteCredential | null = null
  let watcher: FSWatcher | null = null

  ipcMain.handle(CHANNELS.docRead, (_event, path: string) => readFile(path))

  ipcMain.handle(CHANNELS.docWrite, async (_event, path: string, bytesBase64: string) => {
    credential = await writeAtomic(path, Buffer.from(bytesBase64, 'base64'))
    return credential
  })

  ipcMain.handle(CHANNELS.watchFile, async (_event, path: string) => {
    await watcher?.close()
    watcher = await createFileWatcher({
      path,
      getCredential: () => credential,
      onChange: (changed) => getWindow()?.webContents.send(CHANNELS.externalModified, changed),
    })
  })

  return {
    async dispose() {
      await watcher?.close()
      ipcMain.removeHandler(CHANNELS.docRead)
      ipcMain.removeHandler(CHANNELS.docWrite)
      ipcMain.removeHandler(CHANNELS.watchFile)
    },
  }
}