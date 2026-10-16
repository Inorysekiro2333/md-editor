// @vitest-environment jsdom
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/prose/history'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSessionHistory,
  clearHistory,
  loadHistory,
  restoreSessionHistory,
  saveHistory,
} from './session-history'
import { createTestEditor, type TestEditor } from './testing/create-test-editor'

const editors: TestEditor[] = []

async function makeEditor(markdown: string): Promise<TestEditor> {
  const editor = await createTestEditor(markdown)
  editors.push(editor)
  return editor
}

function typeText(editor: TestEditor, text: string): void {
  const view = editor.getView()
  for (const char of text) {
    view.dispatch(view.state.tr.insertText(char))
  }
}

function docText(editor: TestEditor): string {
  return editor.getView().state.doc.textContent
}

function undoAll(editor: TestEditor, target: string): number {
  const view = editor.getView()
  let count = 0
  while (docText(editor) !== target && count < 20) {
    if (!undo(view.state, (tr) => view.dispatch(tr))) break
    count += 1
  }
  return count
}

/** 模拟 EditorHost 恢复协议：外部重载后先重置 doc 为 record 基线再重放，最后以 record 基线保存 */
function simulateRemountAfterExternalReload(
  editor: TestEditor,
  record: NonNullable<ReturnType<typeof loadHistory>>,
  currentMarkdown: string,
): void {
  editor.action((ctx) => {
    restoreSessionHistory(record, ctx.get(editorViewCtx), {
      currentMarkdown,
      parseBase: (markdown) => ctx.get(parserCtx)(markdown),
    })
  })
  saveHistory('doc1', buildSessionHistory(editor.getView().state, record.baseMarkdown))
}

afterEach(async () => {
  clearHistory('doc1')
  for (const editor of editors.splice(0)) {
    await editor.destroy()
  }
})

describe('session history', () => {
  it('returns null for unknown doc ids', () => {
    expect(loadHistory('doc1')).toBeNull()
  })

  it('restores the undo stack after remount', async () => {
    const first = await makeEditor('# Hello')
    typeText(first, 'A')
    await new Promise((resolve) => setTimeout(resolve, 700))
    typeText(first, 'B')
    const record = buildSessionHistory(first.getView().state, '# Hello')
    saveHistory('doc1', record)

    const second = await makeEditor('# Hello')
    restoreSessionHistory(record, second.getView())
    expect(docText(second)).toBe('ABHello')

    // 连续撤销应能一路回到打开时内容（中间可能夹带 heading-id 属性事务组）
    undoAll(second, 'Hello')
    expect(docText(second)).toBe('Hello')
  })

  it('cannot undo without a restored session stack', async () => {
    const editor = await makeEditor('# Hello')
    expect(undo(editor.getView().state)).toBe(false)
  })

  it('keeps the baseline stable across repeated remounts after external reload', async () => {
    // 第一次会话：基线 "# Hello"，用户输入 "A"
    const first = await makeEditor('# Hello')
    typeText(first, 'A')
    saveHistory('doc1', buildSessionHistory(first.getView().state, '# Hello'))

    // 第二次会话：外部重载导致 initialMarkdown 变化，恢复后基线不得被污染
    const second = await makeEditor('外部重写')
    const record2 = loadHistory('doc1')
    expect(record2).not.toBeNull()
    expect(record2?.baseMarkdown).toBe('# Hello')
    simulateRemountAfterExternalReload(second, record2!, '外部重写')

    // 第三次会话：再次外部重载，基线必须仍是 "# Hello"，撤销可达初始内容
    const third = await makeEditor('再次重写')
    const record3 = loadHistory('doc1')
    expect(record3?.baseMarkdown).toBe('# Hello')
    simulateRemountAfterExternalReload(third, record3!, '再次重写')
    expect(docText(third)).toBe('AHello')

    undoAll(third, 'Hello')
    expect(docText(third)).toBe('Hello')
  })

  it('clearHistory drops the saved stack', async () => {
    const editor = await makeEditor('# Hello')
    typeText(editor, 'A')
    saveHistory('doc1', buildSessionHistory(editor.getView().state, '# Hello'))
    clearHistory('doc1')
    expect(loadHistory('doc1')).toBeNull()
  })
})
