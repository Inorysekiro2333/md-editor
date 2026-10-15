export const CHANNELS = {
  appInfo: 'app:info',
  docRead: 'doc:read',
  docWrite: 'doc:write',
  watchFile: 'watch:file',
  externalModified: 'fs:external-modified',
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]