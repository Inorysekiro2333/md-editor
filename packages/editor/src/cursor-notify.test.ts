// @vitest-environment jsdom
import { TextSelection } from '@milkdown/prose/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCursorNotifyPlugin } from './cursor-notify'
import { createTestEditor, type TestEditor } from './testing/create-test-editor'

const MARKDOWN = '# H\n\npara\n'

describe('createCursorNotifyPlugin', () => {
  let editor: TestEditor | null = null

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (editor) {
      await editor.destroy()
      editor = null
    }
  })

  function findTextPos(doc: import('@milkdown/prose/model').Node, text: string): number {
    let found = -1
    doc.descendants((node, pos) => {
      if (node.isText && node.text === text) {
        found = pos
        return false
      }
      return true
    })
    return found
  }

  it('reports md offset for selection changes', async () => {
    const notify = { cb: vi.fn(), buffer: MARKDOWN }
    const plugin = createCursorNotifyPlugin(() => notify)
    editor = await createTestEditor(MARKDOWN, [plugin], [])
    // 编辑器创建时的事务会触发一次发射；先跨过节流窗口再断言增量
    vi.advanceTimersByTime(200)
    const baseline = notify.cb.mock.calls.length
    const view = editor.getView()
    const paraPos = findTextPos(view.state.doc, 'para')
    expect(paraPos).toBeGreaterThan(0)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, paraPos)))
    expect(notify.cb.mock.calls.length).toBeGreaterThan(baseline)
    // 精确值以真实映射为准：'para' 文本起点 md offset = 5（'# H\n' 占 0-4）
    expect(notify.cb).toHaveBeenLastCalledWith(5)
  })

  it('throttles: second change within 150ms is held for trailing emit', async () => {
    const notify = { cb: vi.fn(), buffer: MARKDOWN }
    const plugin = createCursorNotifyPlugin(() => notify)
    editor = await createTestEditor(MARKDOWN, [plugin], [])
    vi.advanceTimersByTime(200)
    const baseline = notify.cb.mock.calls.length
    const view = editor.getView()
    const paraPos = findTextPos(view.state.doc, 'para')
    const hPos = findTextPos(view.state.doc, 'H')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, paraPos)))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, hPos)))
    expect(notify.cb.mock.calls.length).toBe(baseline + 1)
    vi.advanceTimersByTime(150)
    expect(notify.cb.mock.calls.length).toBe(baseline + 2)
    // trailing 补发最后一次位置：'H' 的 md offset = 2
    expect(notify.cb).toHaveBeenLastCalledWith(2)
  })

  it('does nothing when getNotify returns null', async () => {
    const plugin = createCursorNotifyPlugin(() => null)
    editor = await createTestEditor(MARKDOWN, [plugin], [])
    const view = editor.getView()
    expect(() =>
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1))),
    ).not.toThrow()
  })
})
