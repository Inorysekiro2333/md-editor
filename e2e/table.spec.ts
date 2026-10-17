import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CONTENT = '| a | b |\n| :--- | ---: |\n| 1 | 2 |\n| 3 | 4 |\n'
// 初始序列化（R1 登记差异）：cell padding 对齐 + 分隔行缩写（`:-` / `-:`）。
const SERIALIZED = '| a  |  b |\n| :- | -: |\n| 1  |  2 |\n| 3  |  4 |\n'

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: {
      ...process.env,
      MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-table-')),
    },
  })
}

// 注意：Playwright evaluate 的返回值会 JSON 序列化，函数无法传回 Node 侧，
// 因此 __mdEditorDebug.getMarkdown 必须在页面上下文内调用、只返回字符串（AGENTS 教训 2）。
async function getMarkdown(window: Page): Promise<string | null> {
  return window.evaluate(() => {
    const dbg = (window as unknown as { __mdEditorDebug?: { getMarkdown?: () => string } })
      .__mdEditorDebug
    return typeof dbg?.getMarkdown === 'function' ? dbg.getMarkdown() : null
  })
}

// 与 Milkdown 异步创建/防抖收敛交互：未到位时等待重试（参考 e2e/source-mode.spec.ts 门控写法）。
async function expectMarkdownToEventually(
  window: Page,
  check: (md: string) => void,
): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    const md = await getMarkdown(window)
    if (md !== null) {
      let ok = true
      try {
        check(md)
      } catch {
        ok = false
      }
      if (ok) return
    }
    await window.waitForTimeout(100)
  }
  const md = await getMarkdown(window)
  check(md ?? '<__mdEditorDebug.getMarkdown unavailable>')
}

test('table row/column editing full chain and save fidelity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-table-fixture-'))
  const file = join(dir, 'table.md')
  writeFileSync(file, CONTENT)
  const app = await launchApp(file)
  const window = await app.firstWindow()
  const editor = window.locator('.ProseMirror')
  await window.waitForSelector('[data-editor-ready="true"]')

  // 点击单元格让光标进表，工具栏才可见
  await editor.locator('td').filter({ hasText: /^1$/ }).first().click()
  const toolbar = window.getByTestId('table-toolbar')
  await expect(toolbar).toBeVisible()

  // row-below：光标行下方插入空行
  await toolbar.getByTestId('table-toolbar-row-below').click()
  await expectMarkdownToEventually(window, (md) => {
    expect(md).toContain('|    |    |')
  })

  // col-right：新增列复制相邻列对齐 → 左对齐标记 `:-`
  // （R1 登记：prosemirror-tables addColumnAfter 行为，见 table-commands.test.ts 用例 3）
  await toolbar.getByTestId('table-toolbar-col-right').click()
  await expectMarkdownToEventually(window, (md) => {
    expect(md).toContain('| :- |')
  })

  // row-delete：删除光标所在行（新增空行）
  await toolbar.getByTestId('table-toolbar-row-delete').click()
  await expectMarkdownToEventually(window, (md) => {
    expect(md).not.toContain('|    |    |')
  })

  // col-delete：列数回到 2，与初始序列化逐字相等
  await toolbar.getByTestId('table-toolbar-col-delete').click()
  await expectMarkdownToEventually(window, (md) => {
    expect(md).toBe(SERIALIZED)
  })

  // 等防抖收敛窗口（Milkdown listener 内部 200ms + sync 300ms，同 source-mode.spec.ts 约定）
  await window.waitForTimeout(600)
  // 全链路净编辑为零（行/列增删互相抵消，最终 PM doc 与初始 doc 结构相等）：
  // 铁律 1「零编辑保存不写盘」生效，磁盘逐字保留用户原始格式，对齐规范化不静默落盘。
  await window.keyboard.press('Control+s')
  await expect(window.getByTestId('status')).toContainText('无改动，已跳过写盘', {
    timeout: 10_000,
  })
  expect(readFileSync(file, 'utf8')).toBe(CONTENT)
  await app.close()
})

test('column resize keeps markdown and disk content unchanged', async () => {
  test.setTimeout(30_000)
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-table-resize-'))
  const file = join(dir, 'table.md')
  writeFileSync(file, CONTENT)
  const app = await launchApp(file)
  const window = await app.firstWindow()
  const editor = window.locator('.ProseMirror')
  await window.waitForSelector('[data-editor-ready="true"]')

  // 点击表头单元格让光标进表
  await editor.locator('th').first().click()
  await expect(window.getByTestId('table-toolbar')).toBeVisible()

  const mdBefore = await getMarkdown(window)
  expect(mdBefore).not.toBeNull()

  // 列宽拖拽不改 Markdown（colwidth 是视图层属性，R1 登记，见 table-commands.test.ts 用例 10）
  const th = editor.locator('th').first()
  const handle = editor.locator('.column-resize-handle').first()
  // prosemirror-tables 仅在鼠标靠近单元格右缘（handleWidth≈5px）时以 decoration
  // 渲染 .column-resize-handle，因此先 hover 到第一列表头右缘唤出 handle 再拖拽。
  const summonHandle = async (): Promise<void> => {
    const thBox = await th.boundingBox()
    expect(thBox).not.toBeNull()
    if (thBox === null) return
    await window.mouse.move(thBox.x + thBox.width - 2, thBox.y + thBox.height / 2)
    for (let i = 0; i < 15; i += 1) {
      if ((await handle.count()) > 0) return
      await window.mouse.move(thBox.x + thBox.width - 2, thBox.y + thBox.height / 2)
      await window.waitForTimeout(100)
    }
  }
  const dragOnce = async (): Promise<void> => {
    await summonHandle()
    const box = await handle.boundingBox()
    expect(box).not.toBeNull()
    if (box === null) return
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await window.mouse.down()
    await window.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 8 })
    await window.mouse.up()
  }
  // 拖拽前记录第一列宽度（计划 Task 3 用例 2 步骤 2）
  const widthBefore = (await th.boundingBox())?.width ?? -1
  await dragOnce()

  // 断言第一列变宽（+40±10）；CI 不稳时允许重试一次 mouse 序列
  const widthAfter = async (): Promise<number> => (await th.boundingBox())?.width ?? -1
  let width = await widthAfter()
  if (!(width >= widthBefore + 30 && width <= widthBefore + 50)) {
    await dragOnce()
    width = await widthAfter()
  }
  expect(width).toBeGreaterThanOrEqual(widthBefore + 30)
  expect(width).toBeLessThanOrEqual(widthBefore + 50)

  // colwidth 不序列化：Markdown 与拖拽前逐字相等
  const mdAfterDrag = await getMarkdown(window)
  expect(mdAfterDrag).toBe(mdBefore)

  // 等防抖收敛窗口（拖拽 setNodeMarkup 也是一次文档事务）
  await window.waitForTimeout(600)
  // Ctrl+S 后磁盘仍为初始序列化值
  await window.keyboard.press('Control+s')
  await expect(window.getByTestId('status')).toContainText('已保存', { timeout: 10_000 })
  expect(readFileSync(file, 'utf8')).toBe(SERIALIZED)
  await app.close()
})
