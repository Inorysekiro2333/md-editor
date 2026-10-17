import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CONTENT = '# Doc\n\nhello\n'
const EXTERNAL = '# external\n'

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: {
      ...process.env,
      MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-choice-')),
    },
  })
}

// 断言只用编辑器状态真值 __mdEditorDebug.getMarkdown（AGENTS 教训 1/2）。
// Ruling-8 定位：重挂载后旧闭包 hook 指向已 destroy 的 editor（editorViewCtx not found），
// expect.poll 遇 throw 直接失败。捕获后返回 null 让 poll 继续重试，直到新 editor 重绑 hook
// —— 属等待逻辑加固，不改断言语义（断言仍要求精确文本）。
async function readMarkdown(window: Page): Promise<string | null> {
  try {
    return await window.evaluate(() => {
      const dbg = (window as unknown as { __mdEditorDebug?: { getMarkdown?: () => string } })
        .__mdEditorDebug
      return dbg?.getMarkdown ? dbg.getMarkdown() : null
    })
  } catch {
    return null
  }
}

test('dirty external change offers keep or reload choice', async () => {
  test.setTimeout(60_000)
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-choice-fixture-'))
  const file = join(dir, 'choice.md')
  writeFileSync(file, CONTENT)
  const app = await launchApp(file)
  const window = await app.firstWindow()
  await window.waitForSelector('[data-editor-ready="true"]')

  // 编辑成 dirty
  await window.locator('.ProseMirror').click()
  await window.keyboard.press('Control+End')
  await window.keyboard.type('typed')
  await window.waitForTimeout(600)
  await expect(window.locator('[data-testid="tab"]').first()).toHaveAttribute('data-dirty', 'true')

  // 外部写 → modal 出现，文案含「重载」「保留」
  writeFileSync(file, EXTERNAL)
  const modal = window.locator('[data-testid="modal"]')
  await expect(modal).toBeVisible({ timeout: 10_000 })
  await expect(modal).toContainText('重载')
  await expect(modal).toContainText('保留')

  // modal-cancel：保留我的，编辑内容仍在 + 状态文案
  await window.locator('[data-testid="modal-cancel"]').click()
  await expect(modal).toHaveCount(0)
  await expect.poll(() => readMarkdown(window), { timeout: 10_000 }).toContain('typed')
  await expect(window.locator('[data-testid="status"]')).toContainText('已保留我的修改')

  // 再次外部写 → modal-confirm：重载为外部内容精确值（重挂载后仍精确）
  writeFileSync(file, EXTERNAL)
  await expect(modal).toBeVisible({ timeout: 10_000 })
  await window.locator('[data-testid="modal-confirm"]').click()
  await expect.poll(() => readMarkdown(window), { timeout: 10_000 }).toBe(EXTERNAL)
  await expect.poll(() => readMarkdown(window), { timeout: 10_000 }).toBe(EXTERNAL)

  await app.close()
})

test('dirty background external change asks after activation', async () => {
  test.setTimeout(60_000)
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-choice-background-'))
  const activeFile = join(dir, 'active.md')
  const backgroundFile = join(dir, 'background.md')
  writeFileSync(activeFile, CONTENT)
  writeFileSync(backgroundFile, CONTENT)
  const app = await launchApp(activeFile)
  const window = await app.firstWindow()
  await window.waitForSelector('[data-editor-ready="true"]')

  // 打开第二个 tab 并编辑成 dirty，再把活跃 tab 切回第一个，使目标成为后台。
  await app.evaluate(({ BrowserWindow }, path) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app:open-file', path)
  }, backgroundFile)
  const tabs = window.locator('[data-testid="tab"]')
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveAttribute('data-active', 'true')

  await window.locator('.ProseMirror').click()
  await window.keyboard.press('Control+End')
  await window.keyboard.type('typedB')
  await expect(tabs.nth(1)).toHaveAttribute('data-dirty', 'true')

  await tabs.nth(0).locator('.tab-title').click()
  await expect(tabs.nth(0)).toHaveAttribute('data-active', 'true')
  await expect(window.locator('[data-editor-ready="true"]')).toHaveCount(1)

  // 外部改后台 dirty 文件：不得打断当前活跃 tab。
  writeFileSync(backgroundFile, EXTERNAL)
  await window.waitForTimeout(1500)
  await expect(window.locator('[data-testid="modal"]')).toHaveCount(0)

  // 激活后台 tab 后，pending 二选一 modal 才出现；取消仍保留用户内容。
  await tabs.nth(1).locator('.tab-title').click()
  const modal = window.locator('[data-testid="modal"]')
  await expect(modal).toBeVisible({ timeout: 10_000 })
  await window.locator('[data-testid="modal-cancel"]').click()
  await expect(modal).toHaveCount(0)
  await expect.poll(() => readMarkdown(window), { timeout: 10_000 }).toContain('typedB')
  await expect(window.locator('[data-testid="status"]')).toContainText('已保留我的修改')

  await app.close()
})
