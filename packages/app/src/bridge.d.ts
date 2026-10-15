export interface AppInfo {
  version: string
  electron: string
}

export interface MdEditorBridge {
  getAppInfo(): Promise<AppInfo>
}

declare global {
  interface Window {
    mdEditor: MdEditorBridge
  }
}
