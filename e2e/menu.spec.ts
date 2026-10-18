import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
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

  await window.keyboard.press('F11')
  await expect.poll(isFullScreen).toBe(true)
  await window.keyboard.press('F11')
  await expect.poll(isFullScreen).toBe(false)

  await app.close()
})
