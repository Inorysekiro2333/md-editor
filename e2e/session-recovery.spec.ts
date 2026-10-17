import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CONTENT = '# Session\n\noriginal\n'
const TYPED = 'recovered'
const EDITED = '# Session\n\noriginalrecovered\n'

function launchApp(userData: string, file?: string) {
  const args = [resolve(process.cwd())]
  if (file !== undefined) args.push('--open', file)
  return electron.launch({
    args,
    env: { ...process.env, MD_EDITOR_USER_DATA: userData },
  })
}

async function waitReady(window: Page): Promise<void> {
  await expect(window.locator('[data-editor-ready="true"]')).toHaveCount(1)
}

async function getMarkdown(window: Page): Promise<string | null> {
  return window.evaluate(() => {
    const dbg = window as unknown as { __mdEditorDebug?: { getMarkdown?: () => string } }
    return dbg.__mdEditorDebug?.getMarkdown ? dbg.__mdEditorDebug.getMarkdown() : null
  })
}

test('restores dirty tabs from the appdata snapshot after a crash', async () => {
  test.setTimeout(60_000)
  const fixture = mkdtempSync(join(tmpdir(), 'md-editor-session-fixture-'))
  const file = join(fixture, 'a.md')
  writeFileSync(file, CONTENT)
  const userData = mkdtempSync(join(tmpdir(), 'md-editor-session-userdata-'))

  const app = await launchApp(userData, file)
  const window = await app.firstWindow()
  await waitReady(window)

  const editor = window.locator('.ProseMirror')
  await editor.click()
  await window.keyboard.press('Control+End')
  await window.keyboard.type(TYPED)
  await expect(window.locator('[data-testid="tab"]').first()).toHaveAttribute('data-dirty', 'true')

  // 等跨过 5s 快照 interval，再兜底防抖窗口。
  await window.waitForTimeout(6000)

  const edited = await getMarkdown(window)
  expect(edited).toBe(EDITED)
  await app.close()

  // 同 userData 无 --open 重启：模拟崩溃后恢复。
  const relaunched = await launchApp(userData)
  const restored = await relaunched.firstWindow()
  await waitReady(restored)

  await expect(restored.locator('[data-testid="tab"]')).toHaveCount(1)
  await expect.poll(() => getMarkdown(restored), { timeout: 10_000 }).toBe(EDITED)
  await expect(restored.locator('[data-testid="status"]')).toContainText('未保存')
  await relaunched.close()
})
