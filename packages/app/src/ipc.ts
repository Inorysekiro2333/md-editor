import type { MenuCommand } from './bridge'
import type { AppSettings } from '../../../electron/shared/settings'
import type {
  FileContent,
  MdEditorBridge,
  WorkspaceNode,
  WorkspaceUpdate,
  SessionSnapshot,
  WriteCredential,
} from './bridge'

export interface Ipc {
  getAppInfo(): Promise<{ version: string; electron: string; hasCliOpen: boolean }>
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
  toggleFullscreen(): Promise<void>
  showSaveDialog(
    defaultName: string,
    filters?: Array<{ name: string; extensions: string[] }>,
    title?: string,
  ): Promise<string | null>
  showOpenDialog(): Promise<string | null>
  showOpenDirDialog(): Promise<string | null>
  exportPdf(targetPath: string, html?: string): Promise<string>
  exportHtml(targetPath: string, html: string): Promise<string>
  readAssetFile(docPath: string, src: string): Promise<FileContent>
  onMenuCommand(handler: (cmd: MenuCommand) => void): () => void
  getSettings(): Promise<AppSettings>
  setSettings(next: AppSettings): Promise<AppSettings>
  onSettingsChanged(handler: (settings: AppSettings) => void): () => void
}

export function createIpc(bridge: MdEditorBridge): Ipc {
  return {
    getAppInfo: () => bridge.getAppInfo(),
    saveSession: (payload) => bridge.saveSession(payload),
    loadSession: () => bridge.loadSession(),
    removeSession: () => bridge.removeSession(),
    readFile: (path) => bridge.readFile(path),
    writeFile: (path, bytes) => bridge.writeFile(path, bytes),
    watchFile: (path) => bridge.watchFile(path),
    unwatchFile: (path) => bridge.unwatchFile(path),
    confirmClose: () => bridge.confirmClose(),
    saveAsset: (docPath, bytes, ext) => bridge.saveAsset(docPath, bytes, ext),
    openWorkspace: (dir) => bridge.openWorkspace(dir),
    onOpenWorkspace: (handler) => bridge.onOpenWorkspace(handler),
    onWorkspaceTree: (handler) => bridge.onWorkspaceTree(handler),
    onWorkspaceUpdate: (handler) => bridge.onWorkspaceUpdate(handler),
    onExternalModified: (handler) => bridge.onExternalModified(handler),
    onOpenFile: (handler) => bridge.onOpenFile(handler),
    onCloseGuardRequest: (handler) => bridge.onCloseGuardRequest(handler),
    toggleFullscreen: () => bridge.toggleFullscreen(),
    showSaveDialog: (defaultName, filters, title) =>
      bridge.showSaveDialog(defaultName, filters, title),
    showOpenDialog: () => bridge.showOpenDialog(),
    showOpenDirDialog: () => bridge.showOpenDirDialog(),
    exportPdf: (targetPath, html) => bridge.exportPdf(targetPath, html),
    exportHtml: (targetPath, html) => bridge.exportHtml(targetPath, html),
    readAssetFile: (docPath, src) => bridge.readAssetFile(docPath, src),
    onMenuCommand: (handler) => bridge.onMenuCommand(handler),
    getSettings: () => bridge.getSettings(),
    setSettings: (next) => bridge.setSettings(next),
    onSettingsChanged: (handler) => bridge.onSettingsChanged(handler),
  }
}

export const ipc: Ipc = createIpc(window.mdEditor)
