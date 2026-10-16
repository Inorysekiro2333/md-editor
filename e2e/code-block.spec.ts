import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CONTENT = '# Code block e2e\n\n```ts\nconst a = 1\n```\n'

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: {
      ...process.env,
      MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-codeblock-')),
    },
  })
}

test('code block node view: language picker, copy, inline editing and save', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-codeblock-fixture-'))
  const file = join(dir, 'code-block.md')
  writeFileSync(file, CONTENT)
  const app = await launchApp(file)
  const window = await app.firstWindow()
  const editor = window.locator('.ProseMirror')
  await expect(editor).toContainText('const a = 1')

  const select = editor.locator('.md-codeblock-lang')
  await expect(select).toHaveValue('ts')
  const copyButton = editor.locator('.md-codeblock-copy')
  await expect(copyButton).toBeVisible()

  // Type a new line inside the CodeMirror body.
  const cm = editor.locator('.md-codeblock-body .cm-content')
  await cm.click()
  await window.keyboard.press('Control+End')
  await window.keyboard.type('\nconst b = 2')
  await window.waitForTimeout(600)

  await window.keyboard.press('Control+s')
  await expect(window.locator('[data-testid="status"]')).toContainText('已保存', {
    timeout: 10_000,
  })
  const saved = readFileSync(file, 'utf8')
  expect(saved).toBe('# Code block e2e\n\n```ts\nconst a = 1\nconst b = 2\n```\n')
  await app.close()
})
