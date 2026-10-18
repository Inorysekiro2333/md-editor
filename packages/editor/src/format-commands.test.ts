// @vitest-environment jsdom
import { TextSelection } from '@milkdown/prose/state'
import { describe, expect, it } from 'vitest'
import { runFormatCommand } from './format-commands'
import { createTestEditor, type TestEditor } from './testing/create-test-editor'

let editor: TestEditor

async function setup(markdown: string): Promise<void> {
  editor = await createTestEditor(markdown)
}

describe('runFormatCommand headings', () => {
  it('applies H1 to every paragraph in a multi-block selection', async () => {
    await setup('one\n\ntwo\n\nthree')
    try {
      const view = editor.getView()
      const doc = view.state.doc
      view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, 1, doc.content.size - 1)))
      expect(runFormatCommand(view, 'h1')).toBe(true)
      expect(editor.getMarkdown()).toBe('# one\n\n# two\n\n# three\n')
    } finally {
      await editor.destroy()
    }
  })

  it('applies H3 to every paragraph in a multi-block selection', async () => {
    await setup('alpha\n\nbeta\n\ngamma')
    try {
      const view = editor.getView()
      const doc = view.state.doc
      view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, 1, doc.content.size - 1)))
      expect(runFormatCommand(view, 'h3')).toBe(true)
      expect(editor.getMarkdown()).toBe('### alpha\n\n### beta\n\n### gamma\n')
    } finally {
      await editor.destroy()
    }
  })
})
