import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { CHANNELS } from '../shared/channels'

const watcherStub = { close: vi.fn(async () => {}) }
const createFileWatcher = vi.fn(async () => watcherStub)

vi.mock('./watcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./watcher')>()
  return { ...actual, createFileWatcher }
})

type IpcHandler = (event: unknown, ...payload: unknown[]) => unknown
const registered = new Map<string, IpcHandler>()

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0', getPath: () => 'C:/userData' },
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

const saveDialogMock = vi.hoisted(() => vi.fn((): Promise<string | null> => Promise.resolve(null)))

vi.mock('./dialogs', () => ({ showSaveDialog: saveDialogMock }))

const settingsMocks = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
}))

vi.mock('./settings', () => settingsMocks)

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
describe('ipc save dialog channel', () => {
  it('saveDialog delegates the default name and dispose removes the handler', async () => {
    const registry = await register()
    const handler = registered.get(CHANNELS.saveDialog) as IpcHandler
    expect(handler).toBeDefined()

    saveDialogMock.mockResolvedValueOnce('C:/out/kept.md')
    await expect(handler(null, '未命名.md')).resolves.toBe('C:/out/kept.md')
    expect(saveDialogMock).toHaveBeenCalledWith('未命名.md')

    await registry.dispose()
    expect(registered.has(CHANNELS.saveDialog)).toBe(false)
  })
})

describe('ipc fullscreen channel', () => {
  it('toggleFullscreen delegates to the focused window', async () => {
    await register()
    const handler = registered.get(CHANNELS.toggleFullscreen) as IpcHandler
    expect(handler).toBeDefined()

    let full = false
    Object.assign(windowStub, {
      isDestroyed: () => false,
      isFullScreen: () => full,
      setFullScreen: (flag: boolean) => {
        full = flag
      },
    })

    handler(null)
    expect(full).toBe(true)
    handler(null)
    expect(full).toBe(false)
    expect(windowStub.webContents.send).not.toHaveBeenCalledWith(CHANNELS.toggleFullscreen)
  })
})

describe('ipc settings channels', () => {
  it('settingsGet loads settings from the userData path', async () => {
    await register()
    const handler = registered.get(CHANNELS.settingsGet) as IpcHandler
    expect(handler).toBeDefined()

    const stored = { themeId: 'github-dark', export: { pdf: { printBackground: true } } }
    settingsMocks.loadSettings.mockReturnValue(stored)
    expect(handler(null)).toEqual(stored)
    expect(settingsMocks.loadSettings).toHaveBeenCalledWith(join('C:/userData', 'settings.json'))
  })

  it('settingsSet merges whitelist fields, saves, broadcasts and returns the effective value', async () => {
    await register()
    const handler = registered.get(CHANNELS.settingsSet) as IpcHandler
    expect(handler).toBeDefined()

    const effective = { themeId: 'paper-serif', export: { pdf: { printBackground: true } } }
    settingsMocks.saveSettings.mockImplementation(() => {})
    const result = await handler(null, { themeId: 'paper-serif', rogue: 1 })
    expect(result).toEqual(effective)
    expect(settingsMocks.saveSettings).toHaveBeenCalledWith(
      effective,
      join('C:/userData', 'settings.json'),
    )
    expect(windowStub.webContents.send).toHaveBeenCalledWith(CHANNELS.settingsChanged, effective)
  })

  it('dispose removes settings handlers', async () => {
    await register()
    const registry = await (async () => {
      const { registerIpc } = await import('./ipc')
      return registerIpc(
        () => windowStub as never,
        () => {},
        false,
      )
    })()
    await registry.dispose()
    expect(registered.has(CHANNELS.settingsGet)).toBe(false)
    expect(registered.has(CHANNELS.settingsSet)).toBe(false)
  })
})
