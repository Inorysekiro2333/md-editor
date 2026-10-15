import type { FileContent, MdEditorBridge, WriteCredential } from './bridge'

export interface Ipc {
  getAppInfo(): Promise<{ version: string; electron: string }>
  readFile(path: string): Promise<FileContent>
  writeFile(path: string, bytesBase64: string): Promise<WriteCredential>
  watchFile(path: string): Promise<void>
  onExternalModified(handler: (path: string) => void): () => void
  onOpenFile(handler: (path: string) => void): () => void
}

export function createIpc(bridge: MdEditorBridge): Ipc {
  return {
    getAppInfo: () => bridge.getAppInfo(),
    readFile: (path) => bridge.readFile(path),
    writeFile: (path, bytes) => bridge.writeFile(path, bytes),
    watchFile: (path) => bridge.watchFile(path),
    onExternalModified: (handler) => bridge.onExternalModified(handler),
    onOpenFile: (handler) => bridge.onOpenFile(handler),
  }
}

export const ipc: Ipc = createIpc(window.mdEditor)
