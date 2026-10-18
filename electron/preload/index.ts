import { contextBridge, ipcRenderer } from 'electron'
import { isAssetExt } from '../shared/asset'
import { CHANNELS, type MenuCommand } from '../shared/channels'
import type { AppSettings } from '../shared/settings'

export interface AppInfo {
  version: string
  electron: string
  chromium: string
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

const bridge: MdEditorBridge = {
  getAppInfo: () => ipcRenderer.invoke(CHANNELS.appInfo) as Promise<AppInfo>,
  saveSession: (payload) => ipcRenderer.invoke(CHANNELS.sessionSave, payload) as Promise<void>,
  loadSession: () => ipcRenderer.invoke(CHANNELS.sessionLoad) as Promise<SessionSnapshot | null>,
  removeSession: () => ipcRenderer.invoke(CHANNELS.sessionRemove) as Promise<void>,
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
  openWorkspace: (dir) => ipcRenderer.invoke(CHANNELS.openWorkspace, dir) as Promise<void>,
  onOpenWorkspace: (handler) => {
    const listener = (_event: unknown, dir: string): void => handler(dir)
    ipcRenderer.on(CHANNELS.openWorkspace, listener)
    return () => {
      ipcRenderer.removeListener(CHANNELS.openWorkspace, listener)
    }
  },
  onWorkspaceTree: (handler) => {
    const listener = (_event: unknown, nodes: WorkspaceNode[]): void => handler(nodes)
    ipcRenderer.on(CHANNELS.workspaceTree, listener)
    return () => {
      ipcRenderer.removeListener(CHANNELS.workspaceTree, listener)
    }
  },
  onWorkspaceUpdate: (handler) => {
    const listener = (_event: unknown, update: WorkspaceUpdate): void => handler(update)
    ipcRenderer.on(CHANNELS.workspaceUpdate, listener)
    return () => {
      ipcRenderer.removeListener(CHANNELS.workspaceUpdate, listener)
    }
  },
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
  toggleFullscreen: () => ipcRenderer.invoke(CHANNELS.toggleFullscreen) as Promise<void>,
  showSaveDialog: (defaultName, filters, title) =>
    ipcRenderer.invoke(CHANNELS.saveDialog, defaultName, filters, title) as Promise<string | null>,
  showOpenDialog: () => ipcRenderer.invoke(CHANNELS.openDialog) as Promise<string | null>,
  showOpenDirDialog: () => ipcRenderer.invoke(CHANNELS.openDirDialog) as Promise<string | null>,
  exportPdf: (targetPath, html) =>
    ipcRenderer.invoke(CHANNELS.exportPdf, targetPath, html) as Promise<string>,
  exportHtml: (targetPath, html) =>
    ipcRenderer.invoke(CHANNELS.exportHtml, targetPath, html) as Promise<string>,
  readAssetFile: (docPath, src) => {
    if (typeof docPath !== 'string' || docPath.length === 0) {
      return Promise.reject(new Error('无法读取图片：文档路径无效，请先保存文档'))
    }
    if (typeof src !== 'string' || src.length === 0) {
      return Promise.reject(new Error('无法读取图片：路径无效'))
    }
    return ipcRenderer.invoke(CHANNELS.readAssetFile, docPath, src) as Promise<FileContent>
  },
  onMenuCommand: (handler) => {
    const listener = (_event: unknown, cmd: MenuCommand): void => handler(cmd)
    ipcRenderer.on(CHANNELS.menuCommand, listener)
    return () => {
      ipcRenderer.removeListener(CHANNELS.menuCommand, listener)
    }
  },
  getSettings: () => ipcRenderer.invoke(CHANNELS.settingsGet) as Promise<AppSettings>,
  setSettings: (next) => ipcRenderer.invoke(CHANNELS.settingsSet, next) as Promise<AppSettings>,
  onSettingsChanged: (handler) => {
    const listener = (_event: unknown, settings: AppSettings): void => handler(settings)
    ipcRenderer.on(CHANNELS.settingsChanged, listener)
    return () => {
      ipcRenderer.removeListener(CHANNELS.settingsChanged, listener)
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
