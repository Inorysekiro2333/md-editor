import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '../shared/channels'

export interface AppInfo {
  version: string
  electron: string
}

export interface MdEditorBridge {
  getAppInfo(): Promise<AppInfo>
}

const bridge: MdEditorBridge = {
  getAppInfo: () => ipcRenderer.invoke(CHANNELS.appInfo) as Promise<AppInfo>,
}

contextBridge.exposeInMainWorld('mdEditor', bridge)
