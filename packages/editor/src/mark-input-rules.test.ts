// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { TextSelection } from '@milkdown/prose/state'
import { createTestEditor } from './testing/create-test-editor'
import { editorInputRules, editorMarkInputRules } from './input-rules'

/** Simulate per-character typing through ProseMirror handleTextInput. */
async function typeAfter(initial: string, chars: string): Promise<string> {
  const editor = await createTestEditor(initial, [], [editorInputRules, editorMarkInputRules])
  try {
    const view = editor.getView()
    // move caret to end of document
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.near(view.state.doc.resolve(view.state.doc.content.size), -1),
      ),
    )
    for (const ch of chars) {
      const { state } = view
      const handled = view.someProp('handleTextInput', (f) =>
        (f as unknown as (v: typeof view, a: number, b: number, t: string) => boolean)(
          view,
          state.selection.from,
          state.selection.to,
          ch,
        ),
      )
      if (!handled) view.dispatch(state.tr.insertText(ch))
    }
    return editor.getMarkdown()
  } finally {
    await editor.destroy()
  }
}

describe('mark input rules (typed, not pasted)', () => {
  it('bold after word chars', async () => {
    const md = await typeAfter('abc', '**加粗**')
    expect(md).toBe('abc**加粗**\n')
  })
  it('italic after word chars', async () => {
    const md = await typeAfter('abc', '*xx*')
    expect(md).toBe('abc*xx*\n')
  })
  it('strikethrough after word chars', async () => {
    const md = await typeAfter('abc', '~~xx~~')
    expect(md).toBe('abc~~xx~~\n')
  })
  it('bold in empty paragraph', async () => {
    const md = await typeAfter('', '**加粗**')
    expect(md).toBe('**加粗**\n')
  })
  it('bold after inline-code span converts outside the span', async () => {
    const md = await typeAfter('`code', '**xx**')
    expect(md).toBe(
      [92, 96, 99, 111, 100, 101, 42, 42, 120, 120, 42, 42, 10]
        .map((c) => String.fromCharCode(c))
        .join(''),
    )
  })
})
