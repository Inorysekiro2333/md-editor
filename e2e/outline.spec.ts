import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CONTENT = '# A\n\npara\n\n## B\n\nbody\n'

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: {
      ...process.env,
      MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-outline-')),
    },
  })
}

// 光标断言只用编辑器状态真值 __mdEditorDebug.pmSelection（AGENTS 教训 1），
// evaluate 回调内调用、只返回数据（AGENTS 教训 2）。
interface PmSel {
  anchor: number
  head: number
  hasFocus: boolean
}

async function readPmSelection(window: Page): Promise<PmSel | null> {
  return window.evaluate(() => {
    const dbg = (window as unknown as { __mdEditorDebug?: { pmSelection?: () => PmSel } })
      .__mdEditorDebug
    return dbg?.pmSelection ? dbg.pmSelection() : null
  })
}

test('outline lists headings, jumps to heading, and follows cursor highlight', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-outline-fixture-'))
  const file = join(dir, 'outline.md')
  writeFileSync(file, CONTENT)
  const app = await launchApp(file)
  const window = await app.firstWindow()
  const editor = window.locator('.ProseMirror')
  await window.waitForSelector('[data-editor-ready="true"]')

  const items = window.getByTestId('outline-item')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('A')
  await expect(items.nth(1)).toContainText('B')

  // 点击 B 项 → 光标落在 B 标题行。PM pos：heading A [0,3) para [3,9)
  // heading B [9,12)，'B' 文本 pos = 10，md textOffset 13 映射回 10（±1 容差）。
  await items.nth(1).click()
  let pm = await readPmSelection(window)
  for (let i = 0; i < 25 && (pm === null || Math.abs(pm.anchor - 10) > 1); i += 1) {
    await window.waitForTimeout(100)
    pm = await readPmSelection(window)
  }
  expect(pm).not.toBeNull()
  expect(Math.abs((pm as PmSel).anchor - 10)).toBeLessThanOrEqual(1)

  // 把光标点进 'body' 段 → 节流窗口（插件 150ms + App 200ms）后 B 项高亮
  await editor
    .locator('p')
    .filter({ hasText: /^body$/ })
    .first()
    .click()
  await window.waitForTimeout(400)
  await expect(items.nth(1)).toHaveAttribute('data-active', 'true')
  await app.close()
})
