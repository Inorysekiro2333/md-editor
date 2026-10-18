import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function stubSaveDialog(app: import('@playwright/test').ElectronApplication, filePath: string) {
  return app.evaluate(({ dialog }, target) => {
    const stub = dialog as unknown as {
      showSaveDialog: (options?: unknown) => Promise<{ canceled: boolean; filePath: string }>
    }
    stub.showSaveDialog = async () => ({ canceled: false, filePath: target })
  }, filePath)
}

function clickMenuItem(
  app: import('@playwright/test').ElectronApplication,
  id: string,
): Promise<void> {
  return app.evaluate(({ Menu, BrowserWindow }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    const win = BrowserWindow.getAllWindows()[0]
    if (item === undefined || win === undefined) throw new Error('menu item missing')
    item.click(item, win, {})
  }, id)
}

test('pasting an image into an untitled note embeds a data uri, saves and exports', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'md-editor-e2e-'))
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-paste-unnamed-'))
  const target = join(dir, 'note.md')
  const htmlTarget = join(dir, 'note.html')

  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, MD_EDITOR_USER_DATA: userData },
  })
  const window = await app.firstWindow()
  await expect(window.locator('[data-testid="app-info"]')).toBeVisible()

  await clickMenuItem(app, 'menu-new-note')
  await expect(window.locator('[data-testid="tab"]', { hasText: '未命名.md' })).toHaveCount(1)

  // 未命名文档粘贴图片：不允许出现「请先保存」，必须直接插入内嵌 data URI。
  await window.locator('.ProseMirror').click()
  await window.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(
      new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'pic.png', { type: 'image/png' }),
    )
    const targetEl = document.querySelector('.ProseMirror') as HTMLElement
    targetEl.focus()
    targetEl.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
  })

  const img = window.locator('.ProseMirror img:not(.ProseMirror-separator)')
  await expect(img).toHaveCount(1, { timeout: 10_000 })
  await expect(img).toHaveAttribute('src', /^data:image\/png;base64,/)
  await expect(window.locator('[data-testid="status"]')).toContainText('已插入内嵌图片')
  expect(existsSync(join(dir, 'assets'))).toBe(false)

  // 等待 300ms 防抖窗口把 PM Doc 收敛回 Buffer，再触发一次另存为。
  await window.waitForTimeout(600)
  await stubSaveDialog(app, target)
  await window.keyboard.press('Control+s')

  // 首次保存成功：Buffer 中的 data URI 原样落盘，禁止自动改写为 assets 路径。
  await expect(window.locator('[data-testid="status"]')).toContainText('已另存为', {
    timeout: 10_000,
  })
  await expect(window.locator('[data-testid="status"]')).toContainText(
    '图片当前为内嵌 data URI，可手动保留或后续迁移到 assets',
  )
  await expect(window.locator('[data-testid="tab"]', { hasText: 'note.md' })).toHaveCount(1)
  const saved = readFileSync(target, 'utf8')
  expect(saved).toMatch(/!\[\]\(data:image\/png;base64,[^)]+\)/)

  // 导出 HTML：data URI 天然内联，不报错、不改写。
  await stubSaveDialog(app, htmlTarget)
  await clickMenuItem(app, 'menu-export-html')
  await expect(window.locator('[data-testid="status"]')).toContainText('已导出 HTML', {
    timeout: 15_000,
  })
  const html = readFileSync(htmlTarget, 'utf8')
  expect(html).toMatch(/src="data:image\/png;base64,[^"]+"/)

  await app.close()
})

test('remote images stay as external links when exporting html (pending manual 4.4)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-remote-img-'))
  const file = join(dir, 'remote.md')
  const htmlTarget = join(dir, 'remote.html')
  writeFileSync(file, '![remote](https://example.com/a.png)\n')

  const app = await electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
  const window = await app.firstWindow()
  await expect(
    window.locator('.ProseMirror img[src="https://example.com/a.png"]').first(),
  ).toBeVisible({ timeout: 10_000 })

  await stubSaveDialog(app, htmlTarget)
  await clickMenuItem(app, 'menu-export-html')
  await expect(window.locator('[data-testid="status"]')).toContainText('已导出 HTML', {
    timeout: 15_000,
  })

  const html = readFileSync(htmlTarget, 'utf8')
  expect(html).toContain('src="https://example.com/a.png"')

  await app.close()
})
