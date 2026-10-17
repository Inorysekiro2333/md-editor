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
async function readMarkdown(window: Page): Promise<string | null> {
  return window.evaluate(() => {
    const dbg = (window as unknown as { __mdEditorDebug?: { getMarkdown?: () => string } })
      .__mdEditorDebug
    return dbg?.getMarkdown ? dbg.getMarkdown() : null
  })
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
