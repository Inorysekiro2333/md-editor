import { app, ipcMain, type BrowserWindow } from 'electron'
import type { FSWatcher } from 'chokidar'
import { CHANNELS } from '../shared/channels'
import { isValidBase64Payload, ASSET_SAVE_MAX_BYTES, DOC_WRITE_MAX_BYTES } from '../shared/base64'
import { isAssetExt, readFile, saveAssetFile, writeAtomic, type WriteCredential } from './fs_io'
import { createFileWatcher, createWatcherRegistry } from './watcher'
import { createWorkspaceWatcher, walkWorkspace } from './workspace'
import { loadSession, removeSession, saveSession } from './session'
import { toggleFullscreen } from './menu'
import { join } from 'node:path'

export interface IpcRegistry {
  dispose(): Promise<void>
}

export function registerIpc(
  getWindow: () => BrowserWindow | null,
  confirmClose: () => void,
  hasCliOpen: boolean,
): IpcRegistry {
  const credentials = new Map<string, WriteCredential>()
  let workspaceWatcher: FSWatcher | null = null
  const fileWatchers = createWatcherRegistry({
    createWatcher: (path) =>
      createFileWatcher({
        path,
        getCredential: (credentialPath) => credentials.get(credentialPath) ?? null,
        onChange: (changed) => getWindow()?.webContents.send(CHANNELS.externalModified, changed),
      }),
  })

  const sessionPath = (): string => join(app.getPath('userData'), 'session.json')

  ipcMain.handle(CHANNELS.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    hasCliOpen,
  }))

  ipcMain.handle(CHANNELS.sessionSave, async (_event, payload: string) => {
    await saveSession(payload, sessionPath())
  })

  ipcMain.handle(CHANNELS.sessionLoad, () => loadSession(sessionPath()))

  ipcMain.handle(CHANNELS.sessionRemove, () => removeSession(sessionPath()))

  ipcMain.handle(CHANNELS.docRead, (_event, path: string) => readFile(path))

  ipcMain.handle(CHANNELS.docWrite, async (_event, path: string, bytesBase64: string) => {
    // base64 守卫：非法/超限载荷干净拒绝，不写盘、不留 .tmp。
    if (!isValidBase64Payload(bytesBase64, DOC_WRITE_MAX_BYTES)) {
      throw new Error('invalid payload')
    }
    const credential = await writeAtomic(path, Buffer.from(bytesBase64, 'base64'))
    credentials.set(path, credential)
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
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('invalid path')
    }
    // 同 path 幂等 + watch/unwatch/openWorkspace 串行，避免异步建/关 watcher 竞态。
    return fileWatchers.watch(path)
  })

  ipcMain.handle(CHANNELS.unwatchFile, async (_event, path: string) => {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('invalid path')
    }
    return fileWatchers.unwatch(path)
  })

  ipcMain.handle(CHANNELS.openWorkspace, async (_event, dir: string) => {
    if (typeof dir !== 'string' || dir.length === 0) {
      throw new Error('invalid path')
    }
    return fileWatchers.enqueue(async () => {
      // 多次 openWorkspace：关旧 watcher 再开新。
      const previous = workspaceWatcher
      workspaceWatcher = null
      if (previous !== null) {
        await previous.close().catch(() => {})
      }
      const tree = await walkWorkspace(dir)
      getWindow()?.webContents.send(CHANNELS.workspaceTree, tree)
      workspaceWatcher = await createWorkspaceWatcher({
        dir,
        onUpdate: (update) => getWindow()?.webContents.send(CHANNELS.workspaceUpdate, update),
      })
    })
  })

  ipcMain.handle(CHANNELS.confirmClose, () => {
    confirmClose()
  })

  ipcMain.handle(CHANNELS.toggleFullscreen, () => {
    toggleFullscreen(getWindow())
  })

  return {
    async dispose() {
      await fileWatchers.enqueue(async () => {
        await fileWatchers.closeAll()
        const workspace = workspaceWatcher
        workspaceWatcher = null
        if (workspace !== null) await workspace.close().catch(() => {})
      })
      ipcMain.removeHandler(CHANNELS.appInfo)
      ipcMain.removeHandler(CHANNELS.docRead)
      ipcMain.removeHandler(CHANNELS.docWrite)
      ipcMain.removeHandler(CHANNELS.watchFile)
      ipcMain.removeHandler(CHANNELS.unwatchFile)
      ipcMain.removeHandler(CHANNELS.confirmClose)
      ipcMain.removeHandler(CHANNELS.assetSave)
      ipcMain.removeHandler(CHANNELS.openWorkspace)
      ipcMain.removeHandler(CHANNELS.sessionSave)
      ipcMain.removeHandler(CHANNELS.sessionLoad)
      ipcMain.removeHandler(CHANNELS.sessionRemove)
      ipcMain.removeHandler(CHANNELS.toggleFullscreen)
    },
  }
}
