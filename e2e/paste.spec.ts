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

/**
 * 粘贴后的 PM Doc -> Buffer 收敛走 300ms 防抖，测试通过「轮询期间反复 Ctrl+S」
 * 等待落盘内容收敛，避免对内部时序的裸等待。
 */
async function pollSavedContent(
  window: import('@playwright/test').Page,
  file: string,
  expected: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await window.keyboard.press('Control+s')
        return readFileSync(file, 'utf8')
      },
      { timeout: 15_000, intervals: [300, 500, 1_000] },
    )
    .toContain(expected)
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

  // Registered normalization: 粘贴 HTML 与键入共用同一 Milkdown 序列化器
  await pollSavedContent(window, file, '# Pasted')
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
  await expect
    .poll(
      () => {
        const files = existsSync(assetsDir) ? readdirSync(assetsDir) : []
        if (files.length === 1) savedName = files[0]
        return files.length
      },
      { timeout: 10_000, intervals: [100, 250, 500] },
    )
    .toBe(1)
  expect(savedName).toMatch(/\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]+\.png$/)
  expect(readFileSync(join(assetsDir, savedName)).equals(Buffer.from(bytes))).toBe(true)
  await expect(window.locator('.ProseMirror img:not(.ProseMirror-separator)')).toHaveCount(1, {
    timeout: 10_000,
  })

  await pollSavedContent(window, file, `![](assets/${savedName})`)
  await app.close()
})
