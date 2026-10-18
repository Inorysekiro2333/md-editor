import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// 复现人工验证 bug：代码块（文档末块）内输入后，键盘与鼠标都无法把光标移出代码块。
// 断言一律用 __mdEditorDebug.pmSelection 状态真值（AGENTS.md CI/E2E 教训 1），
// 禁止 DOM 选区断言。
//
// 文档 PM 坐标（'# 标题\n\n```js\nconst a = 1\n```\n'）：
//   heading 0..4（文本 1..3），code_block 4..20（内容 5..19，块尾 20）。
//   块内 = 5..19；块外(heading) = 1..3。
// 注：不用 Control+End 定位末尾——浏览器原生「可编辑区末尾」导航会越出嵌套
// contenteditable（独立问题），单行用 End 即可。

const CONTENT = '# 标题\n\n```js\nconst a = 1\n```\n'
const HEADING_END = 3

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: {
      ...process.env,
      MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-codeblock-exit-')),
    },
  })
}

async function openDoc(initial: string) {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-codeblock-exit-doc-'))
  const file = join(dir, 'exit.md')
  writeFileSync(file, initial)
  const app = await launchApp(file)
  const window = await app.firstWindow()
  await window.waitForSelector('[data-editor-ready="true"]')
  const editor = window.locator('.ProseMirror')
  const cm = editor.locator('.md-codeblock .cm-content')
  await expect(cm).toBeVisible()
  return { app, window, editor, cm }
}

/** 点击 CM 行尾并输入后缀，确认输入进入 CM（排除焦点竞态导致的伪失败）。 */
async function typeAtCmEnd(
  cm: ReturnType<import('@playwright/test').Page['locator']>,
  window: import('@playwright/test').Page,
  suffix: string,
) {
  await cm.click()
  await expect(cm).toBeFocused()
  await window.keyboard.press('End')
  await window.keyboard.type(suffix)
  await expect(cm).toContainText(`const a = 1${suffix}`)
}

// PM 选区状态经异步 flush 同步，轮询等待而非固定 sleep
interface AnchorRange {
  min?: number
  max?: number
}
const waitForAnchor = async (window: import('@playwright/test').Page, range: AnchorRange) => {
  await window.waitForFunction(
    (r: AnchorRange) => {
      const debug = (
        window as unknown as {
          __mdEditorDebug?: { pmSelection(): { anchor: number; head: number; hasFocus: boolean } }
        }
      ).__mdEditorDebug
      if (!debug) return false
      const anchor = debug.pmSelection().anchor
      if (r.min !== undefined && anchor < r.min) return false
      if (r.max !== undefined && anchor > r.max) return false
      return true
    },
    range,
    { timeout: 3_000 },
  )
}

test('Escape leaves the code block and typing lands outside', async () => {
  const { app, window, editor, cm } = await openDoc(CONTENT)
  await typeAtCmEnd(cm, window, 'xyz')

  // Escape：从代码块末尾退出（文档末块无后方文本，应向上退出到标题）
  await window.keyboard.press('Escape')
  await waitForAnchor(window, { max: HEADING_END })

  // 退出后可以继续编辑块外区域
  await window.keyboard.type('k')
  await expect(editor.locator('h1')).toContainText('标题k')
  await app.close()
})

test('ArrowDown never strands the PM selection inside the block; mouse click works', async () => {
  const { app, window, editor, cm } = await openDoc(CONTENT)
  await typeAtCmEnd(cm, window, 'xyz')

  // 文档末块下方没有可去位置：ArrowDown 不应把 PM 选区留在块内
  //（修复前 anchor=19 困在块内容末尾并触发焦点拉回）。
  await window.keyboard.press('ArrowDown')
  await waitForAnchor(window, { max: HEADING_END })

  // 鼠标点击标题必须能移出代码块（修复前被 selectionchange 焦点路由吞掉）
  await editor.locator('h1').click()
  await waitForAnchor(window, { max: HEADING_END })
  await app.close()
})

test('code block with trailing paragraph: ArrowDown exits to next paragraph', async () => {
  const { app, window, editor, cm } = await openDoc('before\n\n```js\nconst a = 1\n```\n\nafter\n')
  await typeAtCmEnd(cm, window, 'xyz')

  await window.keyboard.press('ArrowDown')
  // 'before' 0..7，块 7..23（内容 8..22），'after' 段 23..30 → 退出后 anchor >= 24
  await waitForAnchor(window, { min: 24 })

  // 鼠标点击前一段落同样可移出
  await editor.locator('p', { hasText: 'before' }).click()
  await waitForAnchor(window, { max: 7 })
  await app.close()
})
