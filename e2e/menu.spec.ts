import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('installs the native menu and F11 toggles fullscreen', async () => {
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
  const window = await app.firstWindow()
  await expect(window.locator('[data-testid="app-info"]')).toBeVisible()

  const menuState = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    if (menu === null) return null
    const ids = [
      'menu-new-note',
      'menu-open',
      'menu-save-as',
      'menu-export-pdf',
      'menu-toggle-fullscreen',
    ]
    const items = ids.map((id) => {
      const item = menu.getMenuItemById(id)
      return { id, found: item !== null, accelerator: item?.accelerator ?? null }
    })
    return { installed: true, items }
  })
  expect(menuState).not.toBeNull()
  const byId = new Map(menuState!.items.map((item) => [item.id, item]))
  for (const id of menuState!.items.map((item) => item.id)) {
    expect(byId.get(id)?.found, id).toBe(true)
  }
  expect(byId.get('menu-new-note')?.accelerator).toBe('CmdOrCtrl+N')
  expect(byId.get('menu-save-as')?.accelerator).toBe('Shift+CmdOrCtrl+S')
  expect(byId.get('menu-export-pdf')?.accelerator).toBe('CmdOrCtrl+Shift+P')
  expect(byId.get('menu-toggle-fullscreen')?.accelerator).toBe('F11')

  const isFullScreen = (): Promise<boolean> =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())

  // 回归（bug#2）：F11 全屏只保留菜单 accelerator 单通道。
  // renderer 不再监听 F11，合成按键（不经主进程 accelerator）不得切换全屏。
  await window.keyboard.press('F11')
  await window.waitForTimeout(300)
  expect(await isFullScreen()).toBe(false)

  // 菜单项点击 -> toggleFullscreen 幂等切换。
  const clickMenuItem = (id: string): Promise<void> =>
    app.evaluate(({ Menu, BrowserWindow }, itemId) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
      const win = BrowserWindow.getAllWindows()[0]
      if (item === undefined || win === undefined) throw new Error('menu item missing')
      item.click(item, win, {})
    }, id)
  await clickMenuItem('menu-toggle-fullscreen')
  await expect.poll(isFullScreen).toBe(true)
  await clickMenuItem('menu-toggle-fullscreen')
  await expect.poll(isFullScreen).toBe(false)

  await app.close()
})

test('menu open command opens a file via the native open dialog', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'md-editor-e2e-'))
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-open-'))
  const target = join(dir, 'opened.md')
  writeFileSync(target, '# opened-by-menu\n')

  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, MD_EDITOR_USER_DATA: userData },
  })
  const window = await app.firstWindow()
  await expect(window.locator('[data-testid="app-info"]')).toBeVisible()

  // 主进程内 stub 原生打开对话框。
  await app.evaluate(({ dialog }, filePath) => {
    const stub = dialog as unknown as {
      showOpenDialog: (options?: unknown) => Promise<{ canceled: boolean; filePaths: string[] }>
    }
    stub.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, target)

  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('menu-open')
    const win = BrowserWindow.getAllWindows()[0]
    if (item === undefined || win === undefined) throw new Error('menu item missing')
    item.click(item, win, {})
  })

  // 回归（bug#1）：menuCommand 'open' 必须接通 renderer 的 openFile 流程。
  await expect(window.locator('.ProseMirror')).toContainText('opened-by-menu')
  await expect(window.locator('[data-testid="status"]')).toContainText('已打开')
  await expect(window.locator('[data-testid="tab"]', { hasText: 'opened.md' })).toHaveCount(1)

  await app.close()
})
