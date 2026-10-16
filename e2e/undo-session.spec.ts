import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// 会话级撤销栈：编辑器重挂（外部修改触发的自动重载）后，
// Ctrl+Z 应能一路回退到打开时的内容。
test('keeps the undo stack across editor remounts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-undo-'))
  const file = join(dir, 'sample.md')
  writeFileSync(file, '原文内容\n')

  const app = await electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
  const window = await app.firstWindow()
  const editor = window.locator('.ProseMirror')
  await expect(editor).toContainText('原文内容')

  await editor.click()
  await window.keyboard.press('Control+End')
  await window.keyboard.type('追加')
  await window.waitForTimeout(500)
  await window.keyboard.press('Control+s')
  await expect(window.locator('[data-testid="status"]')).toContainText('已保存')
  expect(readFileSync(file, 'utf8')).toContain('追加')

  // 等自身写入的 watch 事件被抑制窗口过去后，外部改写文件 → 触发 EditorHost 重挂
  await window.waitForTimeout(800)
  writeFileSync(file, '外部重写\n')
  // 重挂后撤销栈恢复：内容先回到会话末状态，再逐次 Ctrl+Z 回到打开时内容
  await expect(editor).toContainText('追加', { timeout: 10_000 })
  for (let i = 0; i < 20; i += 1) {
    const text = await editor.textContent()
    if (text !== null && text.includes('原文内容') && !text.includes('追加')) break
    await window.keyboard.press('Control+z')
  }
  const finalText = await editor.textContent()
  expect(finalText).toContain('原文内容')
  expect(finalText).not.toContain('追加')
  expect(finalText).not.toContain('外部重写')
  await app.close()
})
