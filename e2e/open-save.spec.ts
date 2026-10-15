import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
}

async function withFixture<T>(run: (file: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-doc-'))
  const file = join(dir, 'sample.md')
  writeFileSync(file, readFileSync(join(__dirname, 'fixtures/sample.md')))
  return run(file)
}

test('renders the opened markdown file', async () => {
  await withFixture(async (file) => {
    const app = await launchApp(file)
    const window = await app.firstWindow()
    await expect(window.locator('.ProseMirror')).toContainText('Title')
    await app.close()
  })
})

test('saves typed content on ctrl+s', async () => {
  await withFixture(async (file) => {
    const app = await launchApp(file)
    const window = await app.firstWindow()
    const editor = window.locator('.ProseMirror')
    await editor.click()
    await window.keyboard.press('Control+End')
    await window.keyboard.type('typed')
    await window.waitForTimeout(500)
    await window.keyboard.press('Control+s')
    await expect(window.locator('[data-testid="status"]')).toContainText('已保存')

    expect(readFileSync(file, 'utf8')).toContain('typed')
    await app.close()
  })
})

test('does not touch the file when nothing was edited', async () => {
  await withFixture(async (file) => {
    const before = statSync(file)
    const app = await launchApp(file)
    const window = await app.firstWindow()
    await expect(window.locator('.ProseMirror')).toContainText('Title')

    await window.keyboard.press('Control+s')
    await window.waitForTimeout(400)

    const after = statSync(file)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.size).toBe(before.size)
    await app.close()
  })
})
