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

// 光标在其所在块（PM 块节点 / CM 行）内的字符 offset。
// 对普通段落，PM 块文本与 CM 行文本完全一致，因此该 offset 可跨模式比较。
async function caretBlockOffset(window: Page): Promise<number> {
  return window.evaluate(() => {
    const selection = window.getSelection()
    if (
      selection === null ||
      selection.rangeCount === 0 ||
      selection.anchorNode === null ||
      selection.anchorNode.nodeType !== Node.TEXT_NODE
    )
      return -1
    const anchor = selection.anchorNode
    let block: Element | null =
      anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element)
    while (block !== null) {
      if (block.classList.contains('cm-line')) break
      const parent = block.parentElement
      if (parent === null || parent.classList.contains('ProseMirror')) break
      block = parent
    }
    if (block === null) return -1
    const range = document.createRange()
    range.setStart(block, 0)
    range.setEnd(selection.anchorNode, selection.anchorOffset)
    return range.toString().length
  })
}
async function currentMode(window: Page): Promise<'wysiwyg' | 'source'> {
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
    // fixture 第一段在 PM pos 范围 [PM_PARA_START, PM_PARA_END)（heading 占 [0,6)，
    // 段落 content 从 7 起）。DOM 文本锚点检查仅作辅助。
    const PM_PARA_START = 7
    const PM_PARA_END = 33
    await window.waitForSelector('[data-editor-ready="true"]')
    let baseline = 0
    for (let i = 0; i < 25; i += 1) {
      await editor.locator('p').first().click()
      const pm = await window.evaluate(() => {
        const dbg = (
          window as unknown as { __mdEditorDebug?: { pmSelection(): { anchor: number } } }
        ).__mdEditorDebug
        return dbg ? dbg.pmSelection() : null
      })
      const inParagraph = pm !== null && pm.anchor >= PM_PARA_START && pm.anchor < PM_PARA_END
      const domInParagraph = await window.evaluate(() => {
        const sel = window.getSelection()
        const pEl = document.querySelector('.ProseMirror p')
        if (sel === null || sel.anchorNode === null || pEl === null) return false
        if (sel.anchorNode.nodeType !== Node.TEXT_NODE) return false
        return pEl.contains(sel.anchorNode.parentElement) && sel.anchorOffset > 0
      })
      if (inParagraph && domInParagraph) {
        baseline = await caretBlockOffset(window)
        if (baseline > 0) break
      }
      await window.waitForTimeout(100)
    }
    expect(baseline).toBeGreaterThan(0)
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

      let caret = await caretBlockOffset(window)
      for (let j = 0; j < 20 && caret < 0; j += 1) {
        await window.waitForTimeout(50)
        caret = await caretBlockOffset(window)
      }
      if (caret < 0) {
        const dbg = await window.evaluate(() => {
          const sel = window.getSelection()
          return {
            node: sel === null || sel.anchorNode === null ? 'none' : sel.anchorNode.nodeName,
            cls:
              sel === null || sel.anchorNode === null
                ? ''
                : String((sel.anchorNode as Text).parentElement?.className),
            offset: sel === null ? -1 : sel.anchorOffset,
          }
        })
        throw new Error('caret missing in mode ' + mode + ': ' + JSON.stringify(dbg))
      }
      expect(caret).toBeGreaterThanOrEqual(0)
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
      const dbg = await window.evaluate(() => {
        const dump = () => {
          const sel = window.getSelection()
          if (sel === null || sel.anchorNode === null) return { anchor: 'none' }
          const anchor = sel.anchorNode
          const el = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element)
          return {
            nodeType: anchor.nodeType,
            nodeName: anchor.nodeName,
            anchorOffset: sel.anchorOffset,
            parentClass: el?.className ?? '',
            parentText: el?.textContent?.slice(0, 40) ?? '',
            isCollapsed: sel.isCollapsed,
          }
        }
        const pmDbg = (
          window as unknown as {
            __mdEditorDebug?: { pmSelection(): { anchor: number; head: number; hasFocus: boolean } }
          }
        ).__mdEditorDebug
        return { wysiwyg: dump(), pmSelection: pmDbg ? pmDbg.pmSelection() : null }
      })
      throw new Error(
        'cross-mode caret mismatch: ' +
          JSON.stringify({ source: expected.source, wysiwyg: expected.wysiwyg, dom: dbg }),
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
