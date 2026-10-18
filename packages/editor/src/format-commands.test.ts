// @vitest-environment jsdom
import { TextSelection } from '@milkdown/prose/state'
import { describe, expect, it } from 'vitest'
import { runFormatCommand } from './format-commands'
import type { Node as PMNode } from '@milkdown/prose/model'
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

describe('runFormatCommand insertTable', () => {
  it('insertTable places the caret in the first header cell', async () => {
    await setup('hello')
    try {
      const view = editor.getView()
      expect(runFormatCommand(view, 'insertTable')).toBe(true)
      const { state } = view
      const head = state.selection.$head
      let table: PMNode | null = null
      for (let d = head.depth; d > 0; d -= 1) {
        const node = head.node(d)
        if (node.type.name === 'table') table = node
      }
      expect(table?.type.name).toBe('table')
      const firstHeader = table!.child(0).child(0)
      expect(firstHeader.type.name).toBe('table_header')
      // The caret must resolve inside the first th's paragraph so it is
      // immediately visible and arrow keys can move between cells.
      expect(head.node().type.name).toBe('paragraph')
      // Walk up: paragraph -> th -> row -> table
      let inHeader = false
      for (let d = head.depth; d > 0; d -= 1) {
        if (head.node(d).type.name === 'table_header') inHeader = true
      }
      expect(inHeader).toBe(true)
      expect(state.selection instanceof TextSelection).toBe(true)
    } finally {
      await editor.destroy()
    }
  })

  it('insertTable honors rows/cols args (2x4) and keeps default 3x3', async () => {
    await setup('hello')
    try {
      const view = editor.getView()
      expect(runFormatCommand(view, 'insertTable', { rows: 2, cols: 4 })).toBe(true)
      const tables: PMNode[] = []
      view.state.doc.descendants((node) => {
        if (node.type.name === 'table') tables.push(node)
      })
      const table = tables[0]
      expect(table).toBeDefined()
      expect(table.childCount).toBe(2)
      for (let i = 0; i < 2; i += 1) {
        expect(table.child(i).childCount).toBe(4)
      }
      const headerCells = table.child(0)
      for (let i = 0; i < 4; i += 1) {
        expect(headerCells.child(i).type.name).toBe('table_header')
      }
    } finally {
      await editor.destroy()
    }
  })

  it('insertTable puts the caret in the new table when the doc already has one', async () => {
    await setup('| a | b |\n| --- | --- |\n| 1 | 2 |\n\nhello')
    try {
      const view = editor.getView()
      // Move the caret into the trailing paragraph; a fresh selection would
      // otherwise start inside the existing table and be rejected.
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.near(view.state.doc.resolve(view.state.doc.content.size), -1),
        ),
      )
      expect(runFormatCommand(view, 'insertTable')).toBe(true)
      const { state } = view
      const tables: PMNode[] = []
      let selTable: PMNode | null = null
      state.doc.descendants((node) => {
        if (node.type.name === 'table') tables.push(node)
      })
      const head = state.selection.$head
      for (let d = head.depth; d > 0; d -= 1) {
        if (head.node(d).type.name === 'table') selTable = head.node(d)
      }
      expect(tables.length).toBe(2)
      expect(selTable?.type.name).toBe('table')
      expect(selTable).toBe(tables[1])
      let inHeader = false
      for (let d = head.depth; d > 0; d -= 1) {
        if (head.node(d).type.name === 'table_header') inHeader = true
      }
      expect(inHeader).toBe(true)
    } finally {
      await editor.destroy()
    }
  })
})
