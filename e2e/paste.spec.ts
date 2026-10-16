import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
}

test('pasted HTML is serialized as Markdown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-paste-'))
  const file = join(dir, 'doc.md')
  writeFileSync(file, 'start\n')
  const app = await launchApp(file)
  const window = await app.firstWindow()
  await expect(window.locator('.ProseMirror')).toContainText('start')

  await window.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text/html', '<h1>Pasted</h1>')
    const target = document.querySelector('.ProseMirror') as HTMLElement
    target.focus()
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
  })

  await window.waitForTimeout(500)
  await window.keyboard.press('Control+s')
  await expect(window.locator('[data-testid="status"]')).toContainText('已保存')
  const saved = readFileSync(file, 'utf8')
  // Registered normalization: 粘贴 HTML 与键入共用同一 Milkdown 序列化器
  expect(saved).toContain('# Pasted')
  await app.close()
})

test('pasted image is saved under assets/ and referenced in the document', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-paste-img-'))
  const file = join(dir, 'doc.md')
  writeFileSync(file, 'start\n')
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
  const app = await launchApp(file)
  const window = await app.firstWindow()
  await expect(window.locator('.ProseMirror')).toContainText('start')

  await window.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(
      new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'pic.png', { type: 'image/png' }),
    )
    const target = document.querySelector('.ProseMirror') as HTMLElement
    target.focus()
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
  })

  const assetsDir = join(dir, 'assets')
  let savedName = ''
  for (let i = 0; i < 50; i++) {
    if (existsSync(assetsDir)) {
      const files = readdirSync(assetsDir)
      if (files.length === 1) {
        savedName = files[0]
        break
      }
    }
    await window.waitForTimeout(100)
  }
  expect(savedName).toMatch(/\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]+\.png$/)
  await window.waitForTimeout(1500)
  await expect(window.locator('.ProseMirror img:not(.ProseMirror-separator)')).toHaveCount(1, {
    timeout: 10_000,
  })
  await window.waitForTimeout(600)
  expect(readFileSync(join(assetsDir, savedName)).equals(Buffer.from(bytes))).toBe(true)

  await window.keyboard.press('Control+s')
  await expect(window.locator('[data-testid="status"]')).toContainText('已保存')
  const saved = readFileSync(file, 'utf8')
  expect(saved).toContain(`![](assets/${savedName})`)
  await app.close()
})
