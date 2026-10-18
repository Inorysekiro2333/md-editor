import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  isPackaged: false,
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged
    },
  },
  dialog: { showMessageBox: mocks.showMessageBox },
}))

import type { AppUpdater } from 'electron-updater'
import { initUpdater, type UpdaterDeps } from './updater'

function makeDeps(overrides: Partial<UpdaterDeps> = {}): UpdaterDeps {
  const autoUpdater = makeAutoUpdater()
  return {
    autoUpdater: autoUpdater as unknown as AppUpdater,
    setTimeoutFn: ((fn: () => void) => {
      void fn
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout,
    logger: vi.fn(),
    ...overrides,
  }
}

function makeAutoUpdater() {
  const listeners = new Map<string, () => void>()
  return {
    on: vi.fn((event: string, fn: () => void) => {
      listeners.set(event, fn)
    }),
    checkForUpdates: vi.fn(async () => null),
    quitAndInstall: vi.fn(),
    emit(event: string) {
      const fn = listeners.get(event)
      if (fn) void fn()
    },
  }
}

beforeEach(() => {
  mocks.isPackaged = false
  mocks.showMessageBox.mockReset()
  delete process.env.MD_EDITOR_DISABLE_UPDATER
})

describe('initUpdater', () => {
  it('does not check for updates in dev mode (not packaged)', () => {
    const deps = makeDeps()
    initUpdater(() => null, deps)
    expect(deps.autoUpdater.on).not.toHaveBeenCalled()
  })

  it('skips registration when MD_EDITOR_DISABLE_UPDATER=1 even if packaged', () => {
    mocks.isPackaged = true
    process.env.MD_EDITOR_DISABLE_UPDATER = '1'
    const deps = makeDeps()
    initUpdater(() => null, deps)
    expect(deps.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('checks for updates once after 10s in packaged mode', () => {
    mocks.isPackaged = true
    let callback: (() => void) | null = null
    const deps = makeDeps({
      setTimeoutFn: ((fn: () => void) => {
        callback = fn as () => void
        return 0 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout,
    })
    initUpdater(() => null, deps)
    expect(deps.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(deps.autoUpdater.on).toHaveBeenCalledWith('update-downloaded', expect.any(Function))
    callback!()
    expect(deps.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('prompts via dialog and quits to install on confirm', async () => {
    mocks.isPackaged = true
    mocks.showMessageBox.mockResolvedValue({ response: 0 })
    const autoUpdater = makeAutoUpdater()
    const deps = makeDeps({ autoUpdater: autoUpdater as unknown as UpdaterDeps['autoUpdater'] })
    initUpdater(() => null, deps)
    autoUpdater.emit('update-downloaded')
    await vi.waitFor(() => {
      expect(mocks.showMessageBox).toHaveBeenCalledOnce()
    })
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('does not quit when the user declines the dialog', async () => {
    mocks.isPackaged = true
    mocks.showMessageBox.mockResolvedValue({ response: 1 })
    const autoUpdater = makeAutoUpdater()
    const deps = makeDeps({ autoUpdater: autoUpdater as unknown as UpdaterDeps['autoUpdater'] })
    initUpdater(() => null, deps)
    autoUpdater.emit('update-downloaded')
    await vi.waitFor(() => {
      expect(mocks.showMessageBox).toHaveBeenCalledOnce()
    })
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })
})
it('schedules the 10s check with the real setTimeout when setTimeoutFn is not injected', () => {
  mocks.isPackaged = true
  vi.useFakeTimers()
  try {
    const autoUpdater = makeAutoUpdater()
    initUpdater(() => null, {
      autoUpdater: autoUpdater as unknown as AppUpdater,
      logger: vi.fn(),
    })
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})
