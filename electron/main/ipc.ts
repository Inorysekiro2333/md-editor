import { app, ipcMain, type BrowserWindow } from 'electron'
import type { FSWatcher } from 'chokidar'
import { CHANNELS } from '../shared/channels'
import { isValidBase64Payload, ASSET_SAVE_MAX_BYTES, DOC_WRITE_MAX_BYTES } from '../shared/base64'
import { isAssetExt, readFile, saveAssetFile, writeAtomic, type WriteCredential } from './fs_io'
import { createFileWatcher } from './watcher'

export interface IpcRegistry {
  dispose(): Promise<void>
}

export function registerIpc(getWindow: () => BrowserWindow | null): IpcRegistry {
  let credential: WriteCredential | null = null
  let watcher: FSWatcher | null = null

  ipcMain.handle(CHANNELS.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
  }))

  ipcMain.handle(CHANNELS.docRead, (_event, path: string) => readFile(path))

  ipcMain.handle(CHANNELS.docWrite, async (_event, path: string, bytesBase64: string) => {
    // base64 守卫：非法/超限载荷干净拒绝，不写盘、不留 .tmp。
    if (!isValidBase64Payload(bytesBase64, DOC_WRITE_MAX_BYTES)) {
      throw new Error('invalid payload')
    }
    credential = await writeAtomic(path, Buffer.from(bytesBase64, 'base64'))
    return credential
  })

  ipcMain.handle(
    CHANNELS.assetSave,
    async (_event, docPath: string, bytesBase64: string, ext: string) => {
      if (!isValidBase64Payload(bytesBase64, ASSET_SAVE_MAX_BYTES)) {
        throw new Error('invalid payload')
      }
      if (!isAssetExt(ext)) {
        throw new Error('不支持的图片格式')
      }
      if (typeof docPath !== 'string' || docPath.length === 0) {
        throw new Error('无法保存图片：文档路径无效，请先保存文档')
      }
      try {
        return await saveAssetFile(docPath, Buffer.from(bytesBase64, 'base64'), ext)
      } catch (error) {
        // 不向渲染进程泄漏内部路径细节；错误信息为面向用户的结构化文案
        const message = error instanceof Error ? error.message : String(error)
        if (/不支持的图片格式|文档路径无效/.test(message)) throw error
        throw new Error('无法保存图片：写入失败，请重试')
      }
    },
  )

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
      ipcMain.removeHandler(CHANNELS.appInfo)
      ipcMain.removeHandler(CHANNELS.docRead)
      ipcMain.removeHandler(CHANNELS.docWrite)
      ipcMain.removeHandler(CHANNELS.watchFile)
      ipcMain.removeHandler(CHANNELS.assetSave)
    },
  }
}
