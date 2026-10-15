import { contextBridge, ipcRenderer } from 'electron'
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
  onExternalModified(handler: (path: string) => void): () => void
  onOpenFile(handler: (path: string) => void): () => void
}

const bridge: MdEditorBridge = {
  getAppInfo: () => ipcRenderer.invoke(CHANNELS.appInfo) as Promise<AppInfo>,
  readFile: (path) => ipcRenderer.invoke(CHANNELS.docRead, path) as Promise<FileContent>,
  writeFile: (path, bytesBase64) =>
    ipcRenderer.invoke(CHANNELS.docWrite, path, bytesBase64) as Promise<WriteCredential>,
  watchFile: (path) => ipcRenderer.invoke(CHANNELS.watchFile, path) as Promise<void>,
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
}

contextBridge.exposeInMainWorld('mdEditor', bridge)
