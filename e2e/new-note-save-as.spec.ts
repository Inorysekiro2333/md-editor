import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('new untitled note tab appears and Ctrl+S saves it via save-as', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'md-editor-e2e-'))
  const outDir = mkdtempSync(join(tmpdir(), 'md-editor-saveas-'))
  const target = join(outDir, 'note.md')

  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, MD_EDITOR_USER_DATA: userData },
  })
  const window = await app.firstWindow()
  await expect(window.locator('[data-testid="app-info"]')).toBeVisible()

  // 主进程内 stub 原生保存对话框：dialog 是共享单例对象，替换属性即可拦截。
  await app.evaluate(({ dialog }, filePath) => {
    const stub = dialog as unknown as {
      showSaveDialog: (options?: unknown) => Promise<{ canceled: boolean; filePath: string }>
    }
    stub.showSaveDialog = async () => ({ canceled: false, filePath })
  }, target)

  // 通过真实菜单项触发新建（main -> renderer menuCommand 通道）。
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('menu-new-note')
    const win = BrowserWindow.getAllWindows()[0]
    if (item === undefined || win === undefined) throw new Error('menu item missing')
    item.click(item, win, {})
  })

  const untitledTab = window.locator('[data-testid="tab"]', { hasText: '未命名.md' })
  await expect(untitledTab).toHaveCount(1)

  // 输入内容后 Ctrl+S：无路径 tab 自动转另存为。
  await window.locator('.ProseMirror').click()
  await window.keyboard.type('# save-as-e2e')
  await window.waitForTimeout(500)
  await window.keyboard.press('Control+s')

  await expect(window.locator('[data-testid="status"]')).toContainText('已另存为')
  expect(existsSync(target)).toBe(true)
  expect(readFileSync(target, 'utf8')).toContain('# save-as-e2e')
  await expect(window.locator('[data-testid="tab"]', { hasText: 'note.md' })).toHaveCount(1)

  // 另存后已是干净文档：再按 Ctrl+S 不得写盘（mtime 不变）。
  const before = statSync(target)
  await window.keyboard.press('Control+s')
  await window.waitForTimeout(400)
  const after = statSync(target)
  expect(after.mtimeMs).toBe(before.mtimeMs)
  expect(after.size).toBe(before.size)

  await app.close()
})
