import type { FileContent, MdEditorBridge, WriteCredential } from './bridge'

export interface Ipc {
  getAppInfo(): Promise<{ version: string; electron: string }>
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

export function createIpc(bridge: MdEditorBridge): Ipc {
  return {
    getAppInfo: () => bridge.getAppInfo(),
    readFile: (path) => bridge.readFile(path),
    writeFile: (path, bytes) => bridge.writeFile(path, bytes),
    watchFile: (path) => bridge.watchFile(path),
    unwatchFile: (path) => bridge.unwatchFile(path),
    confirmClose: () => bridge.confirmClose(),
    saveAsset: (docPath, bytes, ext) => bridge.saveAsset(docPath, bytes, ext),
    onExternalModified: (handler) => bridge.onExternalModified(handler),
    onOpenFile: (handler) => bridge.onOpenFile(handler),
    onCloseGuardRequest: (handler) => bridge.onCloseGuardRequest(handler),
  }
}

export const ipc: Ipc = createIpc(window.mdEditor)
