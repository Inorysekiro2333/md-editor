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
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]
