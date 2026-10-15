import type { FileContent, MdEditorBridge, WriteCredential } from './bridge'

export interface Ipc {
  readFile(path: string): Promise<FileContent>
  writeFile(path: string, bytesBase64: string): Promise<WriteCredential>
  watchFile(path: string): Promise<void>
  onExternalModified(handler: (path: string) => void): () => void
}

export function createIpc(bridge: MdEditorBridge): Ipc {
  return {
    readFile: (path) => bridge.readFile(path),
    writeFile: (path, bytes) => bridge.writeFile(path, bytes),
    watchFile: (path) => bridge.watchFile(path),
    onExternalModified: (handler) => bridge.onExternalModified(handler),
  }
}

export const ipc: Ipc = createIpc(window.mdEditor)