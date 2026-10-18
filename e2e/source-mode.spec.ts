import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
}

function withFixture<T>(run: (file: string, content: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-source-mode-'))
  const file = join(dir, 'source-mode.md')
  const content = readFileSync(join(__dirname, 'fixtures/source-mode.md'), 'utf8')
  writeFileSync(file, content)
  return run(file, content)
}

// 注意：Playwright evaluate 的返回值会 JSON 序列化，函数无法传回 Node 侧，
// 因此钩子必须在页面上下文内调用，只返回数据。
interface PmSel {
  anchor: number
  head: number
  hasFocus: boolean
}
interface CmSel {
  anchor: number
  hasFocus: boolean
}

async function readPmSelection(window: Page): Promise<PmSel | null> {
  return window.evaluate(() => {
    const dbg = (window as unknown as { __mdEditorDebug?: { pmSelection?: () => PmSel } })
      .__mdEditorDebug
    return dbg?.pmSelection ? dbg.pmSelection() : null
  })
}

async function readCmSelection(window: Page): Promise<CmSel | null> {
  return window.evaluate(() => {
    const dbg = (window as unknown as { __mdEditorDebug?: { cmSelection?: () => CmSel } })
      .__mdEditorDebug
    return dbg?.cmSelection ? dbg.cmSelection() : null
  })
}

async function currentMode(window: {
  getByTestId(id: string): { textContent(): Promise<string | null> }
}): Promise<'wysiwyg' | 'source'> {
  const label = await window.getByTestId('mode-toggle').textContent()
  return label !== null && label.includes('源码') ? 'source' : 'wysiwyg'
}

test('caret and content stay stable across 10 mode toggles', async () => {
  await withFixture(async (file, content) => {
    const app = await launchApp(file)
    const window = await app.firstWindow()
    const editor = window.locator('.ProseMirror')
    await expect(editor).toContainText('中文标题')

    // Milkdown create() 是异步的：过早点击会被初始化重置回文档开头（Linux CI 上必现）。
    // 等编辑器就绪后再点击；点到位以 PM 选区为准（__mdEditorDebug 调试钩子）：
    // fixture 中 heading 占 PM pos [0,6)，段落 content 占 [7,33)，段落文本的 md 起点为 8。
    const PM_PARA_START = 7
    const PM_PARA_END = 33
    await window.waitForSelector('[data-editor-ready="true"]')
    // baseline = pmAnchor - 7：段落内相对 offset（段落 content 从 PM pos 7 起）
    let baseline = 0
    for (let i = 0; i < 25; i += 1) {
      await editor.locator('p').first().click()
      const pm = await window.evaluate(() => {
        const dbg = (
          window as unknown as { __mdEditorDebug?: { pmSelection(): { anchor: number } } }
        ).__mdEditorDebug
        return dbg ? dbg.pmSelection() : null
      })
      if (pm !== null && pm.anchor >= PM_PARA_START && pm.anchor < PM_PARA_END) {
        baseline = pm.anchor - PM_PARA_START
        break
      }
      await window.waitForTimeout(100)
    }
    expect(baseline).toBeGreaterThanOrEqual(0)
    const expected: Partial<Record<'wysiwyg' | 'source', { text: string; caret: number }>> = {}

    for (let i = 0; i < 10; i += 1) {
      await window.keyboard.press('Control+/')
      await window.waitForTimeout(200)
      const mode = await currentMode(window)

      let text: string
      if (mode === 'source') {
        const lines = await window.locator('.cm-content .cm-line').allTextContents()
        text = `${lines.join('\n')}\n`
        expect(text.trimEnd()).toBe(content.trimEnd())
      } else {
        text = (await editor.innerText()).replace(/\r/g, '')
      }

      // 断言全部基于编辑器状态真值：
      // wysiwyg = pmSelection().anchor - 7（段落内相对 offset）；
      // source = cmSelection().anchor - 8（段落行在 CM doc 的起点 = md offset 8，
      // cmSelection().anchor 是 CM doc 全局 offset，段落行内 offset = anchor - 8）。
      let caret = -1
      for (let j = 0; j < 20 && caret < 0; j += 1) {
        const sel =
          mode === 'source' ? await readCmSelection(window) : await readPmSelection(window)
        if (sel !== null) {
          caret = mode === 'source' ? sel.anchor - 8 : sel.anchor - PM_PARA_START
        }
        if (caret < 0) await window.waitForTimeout(50)
      }
      if (caret < 0) {
        throw new Error('debug hooks unavailable in mode ' + mode)
      }
      if (expected[mode] === undefined) {
        expected[mode] = { text, caret }
      } else {
        expect(text).toBe(expected[mode].text)
        expect(caret).toBe(expected[mode].caret)
      }
    }
    // 正文段落的 PM 块文本与 CM 行文本一致，跨模式 caret 必须都等于点击 baseline
    expect(expected.source).toBeDefined()
    expect(expected.wysiwyg).toBeDefined()
    expect(expected.source.caret).toBe(baseline)
    if (expected.source.caret !== expected.wysiwyg.caret) {
      throw new Error(
        'cross-mode caret mismatch: ' +
          JSON.stringify({
            source: expected.source,
            wysiwyg: expected.wysiwyg,
            baseline,
            pmSelection: await readPmSelection(window),
            cmSelection: await readCmSelection(window),
          }),
      )
    }
    expect(expected.source.caret).toBe(expected.wysiwyg.caret)
    await app.close()
  })
})

test('does not touch the file when saving after toggling without edits', async () => {
  await withFixture(async (file) => {
    const before = statSync(file)
    const app = await launchApp(file)
    const window = await app.firstWindow()
    const editor = window.locator('.ProseMirror')
    await expect(editor).toContainText('中文标题')

    await editor.locator('p').first().click()
    await window.getByTestId('mode-toggle').click()
    await expect(window.getByTestId('mode-toggle')).toContainText('源码')
    await window.getByTestId('mode-toggle').click()
    await expect(window.getByTestId('mode-toggle')).toContainText('所见即所得')

    // 等 300ms 防抖收敛窗口过后再触发保存
    await window.waitForTimeout(600)
    await window.keyboard.press('Control+s')
    await window.waitForTimeout(400)

    const after = statSync(file)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.size).toBe(before.size)
    await app.close()
  })
})

test('keeps source-mode edits when switching back to wysiwyg', async () => {
  await withFixture(async (file) => {
    const app = await launchApp(file)
    const window = await app.firstWindow()
    const editor = window.locator('.ProseMirror')
    await expect(editor).toContainText('中文标题')

    await window.getByTestId('mode-toggle').click()
    await expect(window.getByTestId('mode-toggle')).toContainText('源码')
    await window.locator('.cm-content').click()
    await window.keyboard.press('Control+End')
    await window.keyboard.type('追加内容')
    // 等 300ms 防抖窗口让 CM 改动收敛进 Buffer
    await window.waitForTimeout(600)

    await window.getByTestId('mode-toggle').click()
    await expect(window.getByTestId('mode-toggle')).toContainText('所见即所得')
    await expect(editor).toContainText('追加内容')

    await window.keyboard.press('Control+s')
    await expect(window.locator('[data-testid="status"]')).toContainText('已保存', {
      timeout: 10_000,
    })
    expect(readFileSync(file, 'utf8')).toContain('追加内容')
    await app.close()
  })
})

test('format toolbar bold writes ** markers into source buffer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-format-toolbar-'))
  const file = join(dir, 'bold.md')
  writeFileSync(file, 'hello\n')
  const app = await launchApp(file)
  const window = await app.firstWindow()
  const editor = window.locator('.ProseMirror')
  await expect(editor).toContainText('hello')
  await window.waitForSelector('[data-editor-ready="true"]')

  await editor.click()
  // 选中整行文本，再加粗；随后切源码断言 Buffer 含 ** 标记
  await window.keyboard.press('Home')
  await window.keyboard.press('Shift+End')
  await window.getByTestId('format-toolbar').locator('button').first().click()

  await window.keyboard.type('x')
  // 等 300ms 防抖窗口把 WYSIWYG 事务收敛回 Buffer，再切源码断言
  await window.waitForTimeout(400)
  await window.getByTestId('mode-toggle').click()
  await window.waitForSelector('.md-source-editor')
  await expect(window.locator('.md-source-editor')).toContainText('**')
})
