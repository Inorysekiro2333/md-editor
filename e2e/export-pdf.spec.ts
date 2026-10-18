import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('exports the active buffer to a silent pdf via the native menu', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-pdfexp-'))
  const file = join(dir, 'sample.md')
  const target = join(dir, 'out.pdf')
  writeFileSync(file, '# Export smoke\n\ncontent\n')

  const app = await electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
  const window = await app.firstWindow()
  await expect(window.locator('.ProseMirror')).toContainText('Export smoke')

  // 主进程内 stub 原生保存对话框，避免 e2e 弹出真实对话框。
  await app.evaluate(({ dialog }, filePath) => {
    const stub = dialog as unknown as {
      showSaveDialog: (options?: unknown) => Promise<{ canceled: boolean; filePath: string }>
    }
    stub.showSaveDialog = async () => ({ canceled: false, filePath })
  }, target)

  // 通过真实菜单项触发 export-pdf（main -> renderer menuCommand 通道）。
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('menu-export-pdf')
    const win = BrowserWindow.getAllWindows()[0]
    if (item === undefined || win === undefined) throw new Error('menu item missing')
    item.click(item, win, {})
  })

  await expect(window.locator('[data-testid="status"]')).toContainText('已导出 PDF', {
    timeout: 15000,
  })

  expect(existsSync(target)).toBe(true)
  const bytes = readFileSync(target)
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF')
  expect(bytes.length).toBeGreaterThan(0)

  await app.close()
})
