import type { FileContent, MdEditorBridge, WriteCredential } from './bridge'

export interface AppInfo {
  version: string
  electron: string
  hasCliOpen: boolean
}

export interface SessionTabSnapshot {
  path: string
  dirty: boolean
  text: string
}

export interface SessionSnapshot {
  version: number
  savedAt: number
  activePath: string | null
  tabs: SessionTabSnapshot[]
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

export interface WorkspaceNode {
  name: string
  path: string
  type: 'dir' | 'file'
  children?: WorkspaceNode[]
}

export interface WorkspaceUpdate {
  added: string[]
  removed: string[]
}

export interface MdEditorBridge {
  getAppInfo(): Promise<AppInfo>
  saveSession(payload: string): Promise<void>
  loadSession(): Promise<SessionSnapshot | null>
  removeSession(): Promise<void>
  readFile(path: string): Promise<FileContent>
  writeFile(path: string, bytesBase64: string): Promise<WriteCredential>
  watchFile(path: string): Promise<void>
  unwatchFile(path: string): Promise<void>
  confirmClose(): Promise<void>
  saveAsset(docPath: string, bytesBase64: string, ext: string): Promise<string>
  openWorkspace(dir: string): Promise<void>
  onOpenWorkspace(handler: (dir: string) => void): () => void
  onWorkspaceTree(handler: (nodes: WorkspaceNode[]) => void): () => void
  onWorkspaceUpdate(handler: (update: WorkspaceUpdate) => void): () => void
  onExternalModified(handler: (path: string) => void): () => void
  onOpenFile(handler: (path: string) => void): () => void
  onCloseGuardRequest(handler: () => void): () => void
}

declare global {
  interface Window {
    mdEditor: MdEditorBridge
  }
}
