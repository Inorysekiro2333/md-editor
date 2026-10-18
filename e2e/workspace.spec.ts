import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('workspace file tree: structure, click opens tab, incremental add and remove', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-ws-'))
  const sub = join(dir, 'sub')
  mkdirSync(sub)
  writeFileSync(join(dir, 'a.md'), '# Doc A\n\nfirst\n')
  writeFileSync(join(sub, 'b.md'), '# Doc B\n\nsecond\n')
  writeFileSync(join(dir, 'ignore.txt'), 'not markdown\n')

  const app = await electron.launch({
    args: [resolve(process.cwd()), '--open-dir', dir, '--open', join(sub, 'b.md')],
    env: {
      ...process.env,
      MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-ws-ud-')),
    },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.locator('[data-editor-ready="true"]')).toHaveCount(1)

    // 1) 结构与过滤：md 树可见，非 md 不出现
    const tree = window.locator('[data-testid="file-tree"]')
    await expect(tree).toBeVisible()
    await expect(tree).toContainText('b.md')
    await expect(tree).toContainText('a.md')
    await expect(tree).not.toContainText('ignore.txt')

    // 2) 点击 a.md 行 → 打开新 tab 并激活（承接 Task 1）
    const rowA = tree.locator('[data-testid="file-row"]').filter({ hasText: 'a.md' })
    await rowA.click()
    const tabs = window.locator('[data-testid="tab"]')
    await expect(tabs).toHaveCount(2)
    await expect(tabs.nth(1)).toHaveAttribute('data-active', 'true')
    await expect(window.locator('.ProseMirror')).toContainText('Doc A')

    // 3) 外部新增 c.md → 1s 内出现（增量 add）
    writeFileSync(join(dir, 'c.md'), '# Doc C\n')
    const rowC = tree.locator('[data-testid="file-row"]').filter({ hasText: 'c.md' })
    await expect(rowC).toHaveCount(1, { timeout: 1000 })

    // 4) 删除 c.md → 行消失（removed → 全量重建）
    rmSync(join(dir, 'c.md'))
    await expect(rowC).toHaveCount(0, { timeout: 3000 })
    await expect(tree).toContainText('a.md')
  } finally {
    await app.close()
  }
})

test('menu open-dir command loads the workspace file tree', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-ws-menu-'))
  writeFileSync(join(dir, 'menu-a.md'), '# Menu Doc\n')
  const app = await electron.launch({
    args: [resolve(process.cwd()), '--open', join(dir, 'menu-a.md')],
    env: {
      ...process.env,
      MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-ws-menu-ud-')),
    },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.locator('[data-editor-ready="true"]')).toHaveCount(1)
    await app.evaluate(({ dialog }, targetDir) => {
      const stub = dialog as unknown as {
        showOpenDialog: (options?: unknown) => Promise<{ canceled: boolean; filePaths: string[] }>
      }
      stub.showOpenDialog = async () => ({ canceled: false, filePaths: [targetDir] })
    }, dir)
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('menu-open-dir')
      const win = BrowserWindow.getAllWindows()[0]
      if (item === undefined || win === undefined) throw new Error('menu item missing')
      item.click(item, win, {})
    })
    const tree = window.locator('[data-testid="file-tree"]')
    await expect(tree).toBeVisible()
    await expect(tree).toContainText('menu-a.md')
  } finally {
    await app.close()
  }
})
