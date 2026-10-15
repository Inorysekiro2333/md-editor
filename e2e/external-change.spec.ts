import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

async function withFixture<T>(run: (file: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-ext-'))
  const file = join(dir, 'sample.md')
  writeFileSync(file, readFileSync(join(__dirname, 'fixtures/sample.md')))
  return run(file)
}

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
}

test('reloads the editor when the file is changed externally', async () => {
  await withFixture(async (file) => {
    const app = await launchApp(file)
    const window = await app.firstWindow()
    await expect(window.locator('.ProseMirror')).toContainText('Title')

    writeFileSync(file, '# Replaced\n\nexternal body\n')

    await expect(window.locator('.ProseMirror')).toContainText('Replaced', { timeout: 10_000 })
    await expect(window.locator('.notice')).toHaveCount(0)
    await app.close()
  })
})

test('does not warn about external changes for our own save', async () => {
  await withFixture(async (file) => {
    const app = await launchApp(file)
    const window = await app.firstWindow()
    await window.locator('.ProseMirror').click()
    await window.keyboard.press('Control+End')
    await window.keyboard.type(' local edit')
    await window.waitForTimeout(500)
    await window.keyboard.press('Control+s')

    await window.waitForTimeout(800)
    await expect(window.locator('.notice')).toHaveCount(0)
    expect(readFileSync(file, 'utf8')).toContain('local edit')
    await app.close()
  })
})
