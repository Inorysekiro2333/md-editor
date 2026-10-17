import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHANNELS } from '../shared/channels'

const watcherStub = { close: vi.fn(async () => {}) }
const createFileWatcher = vi.fn(async () => watcherStub)

vi.mock('./watcher', () => ({ createFileWatcher }))

type IpcHandler = (event: unknown, ...payload: unknown[]) => unknown
const registered = new Map<string, IpcHandler>()

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0' },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => {
      registered.set(channel, handler)
    },
    removeHandler: (channel: string) => {
      registered.delete(channel)
    },
  },
}))

const windowStub = { webContents: { send: vi.fn() } }

async function register(): Promise<ReturnType<typeof import('./ipc').registerIpc>> {
  const { registerIpc } = await import('./ipc')
  return registerIpc(
    () => windowStub as never,
    () => {},
    false,
  )
}

describe('ipc watcher registry', () => {
  beforeEach(() => {
    registered.clear()
    createFileWatcher.mockClear()
    watcherStub.close.mockClear()
  })

  it('watchFile is idempotent per path and unwatchFile closes once', async () => {
    await register()
    const watch = registered.get(CHANNELS.watchFile) as IpcHandler
    const unwatch = registered.get(CHANNELS.unwatchFile) as IpcHandler

    await watch(null, 'C:/notes/a.md')
    await watch(null, 'C:/notes/a.md')
    expect(createFileWatcher).toHaveBeenCalledTimes(1)

    await unwatch(null, 'C:/notes/a.md')
    expect(watcherStub.close).toHaveBeenCalledTimes(1)

    await unwatch(null, 'C:/notes/a.md')
    expect(watcherStub.close).toHaveBeenCalledTimes(1)
  })

  it('watchFile and unwatchFile reject non-string or empty paths', async () => {
    await register()
    const watch = registered.get(CHANNELS.watchFile) as IpcHandler
    const unwatch = registered.get(CHANNELS.unwatchFile) as IpcHandler

    for (const handler of [watch, unwatch]) {
      await expect(handler(null, 42)).rejects.toThrow('invalid path')
      await expect(handler(null, '')).rejects.toThrow('invalid path')
    }
    expect(createFileWatcher).not.toHaveBeenCalled()
    expect(watcherStub.close).not.toHaveBeenCalled()
  })

  it('dispose closes every remaining watcher', async () => {
    const registry = await register()
    const watch = registered.get(CHANNELS.watchFile) as IpcHandler
    await watch(null, 'C:/notes/a.md')
    await watch(null, 'C:/notes/b.md')

    await registry.dispose()
    expect(watcherStub.close).toHaveBeenCalledTimes(2)
  })

  it('confirmClose notifies the registered callback', async () => {
    const onConfirmClose = vi.fn()
    const { registerIpc } = await import('./ipc')
    registerIpc(() => windowStub as never, onConfirmClose, false)
    const confirm = registered.get(CHANNELS.confirmClose) as IpcHandler
    confirm(null)
    expect(onConfirmClose).toHaveBeenCalledTimes(1)
  })
})
