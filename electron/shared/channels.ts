export const CHANNELS = {
  appInfo: 'app:info',
  docRead: 'doc:read',
  docWrite: 'doc:write',
  watchFile: 'watch:file',
  unwatchFile: 'watch:unwatch',
  externalModified: 'fs:external-modified',
  openFile: 'app:open-file',
  closeGuardRequest: 'app:close-guard',
  confirmClose: 'app:confirm-close',
  assetSave: 'asset:save',
  openWorkspace: 'workspace:open',
  workspaceTree: 'workspace:tree',
  workspaceUpdate: 'workspace:update',
  sessionSave: 'session:save',
  sessionLoad: 'session:load',
  sessionRemove: 'session:remove',
  menuCommand: 'app:menu-command',
  saveDialog: 'app:save-dialog',
  openDialog: 'app:open-dialog',
  openDirDialog: 'app:open-dir-dialog',
  toggleFullscreen: 'window:toggle-fullscreen',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed',
  exportPdf: 'app:export-pdf',
  exportHtml: 'app:export-html',
  readAssetFile: 'asset:read',
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]

export type MenuCommand =
  'new-note' | 'open' | 'open-dir' | 'save-as' | 'export-pdf' | 'export-html' | 'about'
