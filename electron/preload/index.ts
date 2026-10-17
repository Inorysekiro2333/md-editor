import { contextBridge, ipcRenderer } from 'electron'
import { isAssetExt } from '../shared/asset'
import { CHANNELS } from '../shared/channels'

export interface AppInfo {
  version: string
  electron: string
}

export interface FileContent {
  base64: string
  text: string
  eol: 'lf' | 'crlf'
  hasBom: boolean
}

export interface WriteCredential {
  path: string
  size: number
  mtimeMs: number
  writtenAtMs: number
}

export interface MdEditorBridge {
  getAppInfo(): Promise<AppInfo>
  readFile(path: string): Promise<FileContent>
  writeFile(path: string, bytesBase64: string): Promise<WriteCredential>
  watchFile(path: string): Promise<void>
  unwatchFile(path: string): Promise<void>
  confirmClose(): Promise<void>
  saveAsset(docPath: string, bytesBase64: string, ext: string): Promise<string>
  onExternalModified(handler: (path: string) => void): () => void
  onOpenFile(handler: (path: string) => void): () => void
  onCloseGuardRequest(handler: () => void): () => void
}

const bridge: MdEditorBridge = {
  getAppInfo: () => ipcRenderer.invoke(CHANNELS.appInfo) as Promise<AppInfo>,
  readFile: (path) => ipcRenderer.invoke(CHANNELS.docRead, path) as Promise<FileContent>,
  writeFile: (path, bytesBase64) =>
    ipcRenderer.invoke(CHANNELS.docWrite, path, bytesBase64) as Promise<WriteCredential>,
  saveAsset: (docPath, bytesBase64, ext) => {
    if (typeof docPath !== 'string' || docPath.length === 0) {
      return Promise.reject(new Error('无法保存图片：文档路径无效，请先保存文档'))
    }
    if (typeof bytesBase64 !== 'string' || bytesBase64.length === 0) {
      return Promise.reject(new Error('无法保存图片：内容为空'))
    }
    if (!isAssetExt(ext)) {
      return Promise.reject(new Error('不支持的图片格式'))
    }
    return ipcRenderer.invoke(CHANNELS.assetSave, docPath, bytesBase64, ext) as Promise<string>
  },
  watchFile: (path) => ipcRenderer.invoke(CHANNELS.watchFile, path) as Promise<void>,
  unwatchFile: (path) => ipcRenderer.invoke(CHANNELS.unwatchFile, path) as Promise<void>,
  confirmClose: () => ipcRenderer.invoke(CHANNELS.confirmClose) as Promise<void>,
  onExternalModified: (handler) => {
    const listener = (_event: unknown, changed: string): void => handler(changed)
    ipcRenderer.on(CHANNELS.externalModified, listener)
    return () => {
      ipcRenderer.removeListener(CHANNELS.externalModified, listener)
    }
  },
  onOpenFile: (handler) => {
    const listener = (_event: unknown, opened: string): void => handler(opened)
    ipcRenderer.on(CHANNELS.openFile, listener)
    return () => {
      ipcRenderer.removeListener(CHANNELS.openFile, listener)
    }
  },
  onCloseGuardRequest: (handler) => {
    const listener = (): void => handler()
    ipcRenderer.on(CHANNELS.closeGuardRequest, listener)
    return () => {
      ipcRenderer.removeListener(CHANNELS.closeGuardRequest, listener)
    }
  },
}

contextBridge.exposeInMainWorld('mdEditor', bridge)
