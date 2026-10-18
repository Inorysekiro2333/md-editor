import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// 回归：已保存文档粘贴图片落盘 assets/<file>.png，Buffer 为相对路径。
// 导出 HTML 会内联（不受影响），但 WYSIWYG 编辑器此前用相对 src 直接渲染，
// 相对 app 基准 URL 解析失败 -> 图片不可见。修复后编辑器显示层经
// readAssetFile 解析为 data URI，Buffer/序列化保持相对路径不变（R1）。
test('pasting an image into a saved note renders in the editor while buffer keeps relative path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-paste-saved-'))
  const file = join(dir, 'note.md')
  writeFileSync(file, '# hello\n')

  const app = await electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
  const window = await app.firstWindow()
  await window.waitForSelector('[data-editor-ready="true"]')
  await window.locator('.ProseMirror').click()
  await window.evaluate((pngB64: string) => {
    const dt = new DataTransfer()
    const bytes = Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0))
    dt.items.add(new File([bytes], 'pic.png', { type: 'image/png' }))
    const targetEl = document.querySelector('.ProseMirror') as HTMLElement
    targetEl.focus()
    targetEl.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
  }, PNG_1PX)

  const img = window.locator('.ProseMirror img:not(.ProseMirror-separator)')
  await expect(img).toHaveCount(1, { timeout: 10_000 })
  // 显示层：相对路径被解析为 data URI 且真实解码（naturalWidth > 0）
  await expect
    .poll(
      async () =>
        window.evaluate(() => {
          const el = document.querySelector(
            '.ProseMirror img:not(.ProseMirror-separator)',
          ) as HTMLImageElement | null
          return el === null ? null : el.getAttribute('src')
        }),
      { timeout: 10_000 },
    )
    .toMatch(/^data:image\/png;base64,/)
  await expect
    .poll(
      async () =>
        window.evaluate(() => {
          const el = document.querySelector(
            '.ProseMirror img:not(.ProseMirror-separator)',
          ) as HTMLImageElement | null
          return el === null ? -1 : el.naturalWidth
        }),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0)

  // 等 300ms 防抖收敛后，Buffer 必须保持相对路径（round-trip 不受显示层影响）
  await window.waitForTimeout(600)
  expect(
    await window.evaluate(() =>
      (
        window as unknown as {
          __mdEditorDebug: { getMarkdown(): string }
        }
      ).__mdEditorDebug.getMarkdown(),
    ),
  ).toMatch(/!\[\]\(assets\/[^)]+\.png\)/)
  await app.close()
})
