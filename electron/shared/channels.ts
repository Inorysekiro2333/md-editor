export const CHANNELS = {
  appInfo: 'app:info',
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]
