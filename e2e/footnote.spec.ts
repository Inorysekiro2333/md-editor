import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
}

test('typing footnote reference and definition round-trips', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-footnote-'))
  const file = join(dir, 'sample.md')
  writeFileSync(file, '')
  const app = await launchApp(file)
  const window = await app.firstWindow()
  const editor = window.locator('.ProseMirror')
  await editor.click()
  await window.keyboard.type('See note[^1]')
  // 键入 `[^1]` 后立即渲染为引用节点（sup）
  await expect(editor.locator('sup[data-type="footnote_reference"]')).toHaveText('1')
  await window.keyboard.press('Enter')
  await window.keyboard.type('[^1]: the note')
  // 行首 `[^label]:` 被输入规则转换为定义块
  await expect(editor.locator('dl[data-type="footnote_definition"]')).toHaveCount(1)
  await window.waitForTimeout(500)
  await window.keyboard.press('Control+s')
  await expect(window.locator('[data-testid="status"]')).toContainText('已保存')
  expect(readFileSync(file, 'utf8')).toBe('See note[^1]\n\n[^1]: the note\n')
  await app.close()
})

test('parsing an existing footnote file renders references and definitions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-footnote-'))
  const file = join(dir, 'sample.md')
  writeFileSync(file, 'Text[^1] and [^2]\n\n[^1]: note one\n\n[^2]: note two\n')
  const app = await launchApp(file)
  const window = await app.firstWindow()
  const editor = window.locator('.ProseMirror')
  await expect(editor.locator('sup[data-type="footnote_reference"]')).toHaveCount(2)
  await expect(editor.locator('dl[data-type="footnote_definition"]')).toHaveCount(2)
  await app.close()
})
