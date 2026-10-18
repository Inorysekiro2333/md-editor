import { describe, expect, it, vi } from 'vitest'
import { CHANNELS } from '../shared/channels'
import type { MenuItemConstructorOptions } from 'electron'
import { buildTemplate, toggleFullscreen, type MenuDeps } from './menu'

interface FakeWindow {
  isFullScreen(): boolean
  setFullScreen(flag: boolean): void
  isDestroyed(): boolean
}

function createDeps(): MenuDeps & { commands: string[] } {
  const commands: string[] = []
  return {
    commands,
    onCommand: (cmd) => commands.push(cmd),
    onClose: vi.fn(),
    toggleFullscreen: vi.fn(),
  }
}

function findItem(
  template: MenuItemConstructorOptions[],
  id: string,
): MenuItemConstructorOptions | undefined {
  for (const item of template) {
    if (item.id === id) return item
    const nested = item.submenu ? (item.submenu as MenuItemConstructorOptions[]) : []
    const hit = findItem(nested, id)
    if (hit) return hit
  }
  return undefined
}

describe('menu template', () => {
  it('file commands call the injected handler', () => {
    const deps = createDeps()
    const template = buildTemplate(deps)

    const cases: Array<[string, string]> = [
      ['menu-new-note', 'new-note'],
      ['menu-open', 'open'],
      ['menu-save-as', 'save-as'],
      ['menu-export-pdf', 'export-pdf'],
    ]
    for (const [id, cmd] of cases) {
      const item = findItem(template, id)
      expect(item, id).toBeDefined()
      item?.click?.(undefined as never, undefined as never, undefined as never)
      expect(deps.commands.at(-1)).toBe(cmd)
    }
  })

  it('file shortcuts match the plan', () => {
    const template: MenuItemConstructorOptions[] = buildTemplate(createDeps())
    expect(findItem(template, 'menu-new-note')?.accelerator).toBe('CmdOrCtrl+N')
    expect(findItem(template, 'menu-open')?.accelerator).toBe('CmdOrCtrl+O')
    expect(findItem(template, 'menu-save-as')?.accelerator).toBe('Shift+CmdOrCtrl+S')
    expect(findItem(template, 'menu-export-pdf')?.accelerator).toBe('CmdOrCtrl+Shift+P')
  })

  it('view menu exposes F11 fullscreen toggle through deps', () => {
    const deps = createDeps()
    const template = buildTemplate(deps)
    const item = findItem(template, 'menu-toggle-fullscreen')
    expect(item?.accelerator).toBe('F11')
    const win = {
      isFullScreen: () => false,
      setFullScreen: () => {},
      isDestroyed: () => false,
    } as unknown as FakeWindow
    item?.click?.(undefined as never, win as never, undefined as never)
    expect(deps.toggleFullscreen).toHaveBeenCalledWith(win)
  })

  it('exit item routes through the close guard instead of app.quit', () => {
    const deps = createDeps()
    const item = findItem(buildTemplate(deps), 'menu-exit')
    item?.click?.(undefined as never, undefined as never, undefined as never)
    expect(deps.onClose).toHaveBeenCalledTimes(1)
  })
})

describe('toggleFullscreen', () => {
  function fakeWindow(initial: boolean) {
    let full = initial
    return {
      isDestroyed: () => false,
      isFullScreen: () => full,
      setFullScreen: (flag: boolean) => {
        full = flag
      },
    } satisfies FakeWindow
  }

  it('two consecutive invocations restore the original state', () => {
    const win = fakeWindow(false)
    toggleFullscreen(win as never)
    expect(win.isFullScreen()).toBe(true)
    toggleFullscreen(win as never)
    expect(win.isFullScreen()).toBe(false)
    toggleFullscreen(win as never)
    expect(win.isFullScreen()).toBe(true)
  })

  it('is safe when the window is gone', () => {
    expect(() => toggleFullscreen(null)).not.toThrow()
    const destroyed = { ...fakeWindow(true), isDestroyed: () => true }
    expect(() => toggleFullscreen(destroyed as never)).not.toThrow()
    expect(destroyed.isFullScreen()).toBe(true)
  })
})

describe('channels', () => {
  it('menu command and fullscreen channels are whitelisted', () => {
    expect(CHANNELS.menuCommand).toBe('app:menu-command')
    expect(CHANNELS.toggleFullscreen).toBe('window:toggle-fullscreen')
  })
})
