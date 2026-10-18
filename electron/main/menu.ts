import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/channels'

export interface MenuDeps {
  onCommand: (cmd: MenuCommand) => void
  /** 菜单「退出」走 close 事件触发 dirty 守卫，不直接 app.quit()。 */
  onClose: () => void
  toggleFullscreen: (win: BrowserWindow | null) => void
}

/** 幂等：任何通道重复触发都只按当前状态取反一次。 */
export function toggleFullscreen(win: BrowserWindow | null): void {
  if (win === null || win.isDestroyed()) return
  win.setFullScreen(!win.isFullScreen())
}

function clickFor(deps: MenuDeps, cmd: MenuCommand): () => void {
  return () => deps.onCommand(cmd)
}

export function buildTemplate(deps: MenuDeps): MenuItemConstructorOptions[] {
  return [
    {
      label: '文件',
      submenu: [
        {
          id: 'menu-new-note',
          label: '新建',
          accelerator: 'CmdOrCtrl+N',
          click: clickFor(deps, 'new-note'),
        },
        {
          id: 'menu-open',
          label: '打开...',
          accelerator: 'CmdOrCtrl+O',
          click: clickFor(deps, 'open'),
        },
        {
          id: 'menu-open-dir',
          label: '打开文件夹...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: clickFor(deps, 'open-dir'),
        },
        { type: 'separator' },
        {
          id: 'menu-save-as',
          label: '另存为...',
          accelerator: 'Shift+CmdOrCtrl+S',
          click: clickFor(deps, 'save-as'),
        },
        {
          id: 'menu-export-pdf',
          label: '导出 PDF...',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: clickFor(deps, 'export-pdf'),
        },
        {
          id: 'menu-export-html',
          label: '导出 HTML...',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: clickFor(deps, 'export-html'),
        },

        { type: 'separator' },
        { id: 'menu-exit', label: '退出', click: () => deps.onClose() },
      ],
    },
    { label: '编辑', role: 'editMenu' },
    {
      label: '视图',
      submenu: [
        {
          id: 'menu-toggle-fullscreen',
          label: '全屏',
          accelerator: 'F11',
          click: (_item, win) => deps.toggleFullscreen((win as BrowserWindow | null) ?? null),
        },
      ],
    },
    { label: '帮助', submenu: [{ role: 'about' }] },
  ]
}
