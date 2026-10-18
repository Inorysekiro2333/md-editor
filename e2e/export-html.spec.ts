import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('exports the active buffer to a self-contained html via the native menu', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-htmlexp-'))
  const file = join(dir, 'sample.md')
  const target = join(dir, 'out.html')
  writeFileSync(file, '# Export smoke\n\ncontent\n')

  const app = await electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
  const window = await app.firstWindow()
  await expect(window.locator('.ProseMirror')).toContainText('Export smoke')

  await app.evaluate(({ dialog }, filePath) => {
    const stub = dialog as unknown as {
      showSaveDialog: (options?: unknown) => Promise<{ canceled: boolean; filePath: string }>
    }
    stub.showSaveDialog = async () => ({ canceled: false, filePath })
  }, target)

  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('menu-export-html')
    const win = BrowserWindow.getAllWindows()[0]
    if (item === undefined || win === undefined) throw new Error('menu item missing')
    item.click(item, win, {})
  })

  await expect(window.locator('[data-testid="status"]')).toContainText('已导出 HTML', {
    timeout: 15000,
  })

  expect(existsSync(target)).toBe(true)
  const html = readFileSync(target, 'utf8')
  expect(html).toContain('<style>')
  expect(html).toContain('<h1>Export smoke</h1>')
  expect(html).toContain('content')
  expect(html).toContain('Content-Security-Policy')
  expect(html).not.toContain('<script')

  await app.close()
})
