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
}

declare global {
  interface Window {
    mdEditor: MdEditorBridge
  }
}