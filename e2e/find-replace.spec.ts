import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CONTENT = 'alpha beta\ngamma alpha\n'

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: {
      ...process.env,
      MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-find-')),
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

async function readMarkdown(window: Page): Promise<string | null> {
  return window.evaluate(() => {
    const dbg = (window as unknown as { __mdEditorDebug?: { getMarkdown?: () => string } })
      .__mdEditorDebug
    return dbg?.getMarkdown ? dbg.getMarkdown() : null
  })
}

test('find and replace works over the buffer with navigation and regex groups', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-find-fixture-'))
  const file = join(dir, 'find.md')
  writeFileSync(file, CONTENT)
  const app = await launchApp(file)
  const window = await app.firstWindow()
  await window.waitForSelector('[data-editor-ready="true"]')

  await window.keyboard.press('Control+f')
  const panel = window.getByTestId('find-panel')
  await expect(panel).toBeVisible()

  await window.getByTestId('find-input').fill('alpha')
  await expect(window.getByTestId('find-count')).toHaveText('2 个结果')

  // 第一处 alpha：段落文本从 PM pos 1 开始
  await window.getByTestId('find-next').click()
  let pm = await readPmSelection(window)
  for (let i = 0; i < 25 && (pm === null || pm.anchor !== 1); i += 1) {
    await window.waitForTimeout(100)
    pm = await readPmSelection(window)
  }
  expect(pm).not.toBeNull()
  expect((pm as PmSel).anchor).toBe(1)

  // 第二处跨行：alpha2 md offset 17 -> PM pos 18（text+hardbreak+text 各 +1）
  await window.getByTestId('find-next').click()
  let pm2 = await readPmSelection(window)
  for (let i = 0; i < 25 && (pm2 === null || pm2.anchor <= 1); i += 1) {
    await window.waitForTimeout(100)
    pm2 = await readPmSelection(window)
  }
  expect(pm2).not.toBeNull()
  const second = (pm2 as PmSel).anchor

  expect(second).toBeGreaterThan((pm as PmSel).anchor)

  // 单次替换：Buffer replaceText + 重挂载后 getMarkdown 真值
  await window.getByTestId('find-replace-input').fill('omega')
  await window.getByTestId('find-replace').click()
  await window.waitForTimeout(600)
  expect(await readMarkdown(window)).toBe('omega beta\ngamma alpha\n')

  // 全部替换
  await window.getByTestId('find-replace-all').click()
  await window.waitForTimeout(600)
  expect(await readMarkdown(window)).toBe('omega beta\ngamma omega\n')

  // 正则分组 $2 $1
  await window.getByTestId('find-regex').click()
  await window.getByTestId('find-input').fill('(\\w+) (\\w+)')
  await expect(window.getByTestId('find-count')).toHaveText('2 个结果')
  await window.getByTestId('find-replace-input').fill('$2 $1')
  await window.getByTestId('find-replace-all').click()
  await window.waitForTimeout(600)
  expect(await readMarkdown(window)).toBe('beta omega\nomega gamma\n')

  // Ctrl+S 落盘
  await window.keyboard.press('Control+s')
  await expect(window.getByTestId('status')).toContainText('已保存')
  expect(readFileSync(file, 'utf8')).toBe('beta omega\nomega gamma\n')

  await app.close()
})
