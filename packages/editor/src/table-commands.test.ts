// @vitest-environment jsdom
import { TextSelection } from '@milkdown/prose/state'
import { selectedRect } from '@milkdown/prose/tables'
import { describe, expect, it } from 'vitest'
import {
  addColumnLeft,
  addColumnRight,
  addRowAbove,
  addRowBelow,
  deleteTableColumn,
  deleteTableRow,
  type TableCommand,
} from './table-commands'
import { createTestEditor, type TestEditor } from './testing/create-test-editor'

const ALIGNED = '| a | b |\n| :--- | ---: |\n| 1 | 2 |\n| 3 | 4 |\n'

// Registered normalization (R1): cell padding (registered in M1); column widths
// (colwidth) are view-only attributes and never serialize into Markdown.
const SERIALIZED_ALIGNED = '| a  |  b |\n| :- | -: |\n| 1  |  2 |\n| 3  |  4 |\n'

function placeCursor(editor: TestEditor, cellText: string): void {
  const view = editor.getView()
  const doc = view.state.doc
  let target = -1
  doc.descendants((node, pos) => {
    if (target < 0 && node.isTextblock && node.textContent === cellText) {
      target = pos
      return false
    }
    return true
  })
  if (target < 0) throw new Error(`cell not found: ${cellText}`)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, target + 1)))
}

function runCommand(cmd: TableCommand): boolean {
  let result = false
  editor.action((ctx) => {
    const view = editor.getView()
    result = cmd(ctx, view.state, (tr) => view.dispatch(tr))
  })
  return result
}

let editor: TestEditor

async function setup(markdown: string): Promise<void> {
  editor = await createTestEditor(markdown)
}

describe('table-commands', () => {
  it('addRowBelow inserts an aligned row below the cursor row', async () => {
    await setup(ALIGNED)
    try {
      placeCursor(editor, '1')
      expect(runCommand(addRowBelow)).toBe(true)
      expect(editor.getMarkdown()).toBe(
        '| a  |  b |\n| :- | -: |\n| 1  |  2 |\n|    |    |\n| 3  |  4 |\n',
      )
    } finally {
      await editor.destroy()
    }
  })

  it('addRowBelow moves the cursor into the new row', async () => {
    await setup(ALIGNED)
    try {
      placeCursor(editor, '1')
      expect(runCommand(addRowBelow)).toBe(true)
      // Ruling-2 (2026-10-17): row insertion commands move the cursor into the
      // first cell of the newly inserted row in the same transaction.
      expect(editor.getMarkdown()).toBe(
        '| a  |  b |\n| :- | -: |\n| 1  |  2 |\n|    |    |\n| 3  |  4 |\n',
      )
      const rect = selectedRect(editor.getView().state)
      expect(rect.top).toBe(2)
      expect(rect.left).toBe(0)
      const cell = editor
        .getView()
        .state.doc.nodeAt(rect.tableStart + rect.map.positionAt(rect.top, rect.left, rect.table))
      expect(cell?.type.name).toBe('table_cell')
      expect(cell?.textContent).toBe('')
    } finally {
      await editor.destroy()
    }
  })

  it('addRowAbove inserts an aligned row above the cursor row', async () => {
    await setup(ALIGNED)
    try {
      placeCursor(editor, '3')
      expect(runCommand(addRowAbove)).toBe(true)
      expect(editor.getMarkdown()).toBe(
        '| a  |  b |\n| :- | -: |\n| 1  |  2 |\n|    |    |\n| 3  |  4 |\n',
      )
    } finally {
      await editor.destroy()
    }
  })

  it('addColumnRight copies neighbor alignment as left-align', async () => {
    await setup(ALIGNED)
    try {
      placeCursor(editor, '2')
      expect(runCommand(addColumnRight)).toBe(true)
      // Registered normalization (R1): new column copies neighbor alignment,
      // producing a left-align mark `:-` (prosemirror-tables addColumnAfter).
      expect(editor.getMarkdown()).toBe(
        '| a  |  b |    |\n| :- | -: | :- |\n| 1  |  2 |    |\n| 3  |  4 |    |\n',
      )
    } finally {
      await editor.destroy()
    }
  })

  it('addColumnRight moves the cursor into the new column', async () => {
    await setup(ALIGNED)
    try {
      placeCursor(editor, '1')
      expect(runCommand(addColumnRight)).toBe(true)
      // Ruling-2 (2026-10-17): column insertion commands move the cursor into
      // the new column cell of the cursor row in the same transaction.
      expect(editor.getMarkdown()).toBe(
        '| a  |    |  b |\n| :- | :- | -: |\n| 1  |    |  2 |\n| 3  |    |  4 |\n',
      )
      const rect = selectedRect(editor.getView().state)
      expect(rect.top).toBe(1)
      expect(rect.left).toBe(1)
      const cell = editor
        .getView()
        .state.doc.nodeAt(rect.tableStart + rect.map.positionAt(rect.top, rect.left, rect.table))
      expect(cell?.type.name).toBe('table_cell')
      expect(cell?.textContent).toBe('')
    } finally {
      await editor.destroy()
    }
  })

  it('addColumnLeft copies neighbor alignment as left-align', async () => {
    await setup(ALIGNED)
    try {
      placeCursor(editor, '1')
      expect(runCommand(addColumnLeft)).toBe(true)
      // Registered normalization (R1): new column copies neighbor alignment,
      // producing a left-align mark `:-` (prosemirror-tables addColumnBefore).
      expect(editor.getMarkdown()).toBe(
        '|    | a  |  b |\n| :- | :- | -: |\n|    | 1  |  2 |\n|    | 3  |  4 |\n',
      )
    } finally {
      await editor.destroy()
    }
  })

  it('deleteTableRow deletes the cursor row', async () => {
    await setup(ALIGNED)
    try {
      placeCursor(editor, '3')
      expect(runCommand(deleteTableRow)).toBe(true)
      expect(editor.getMarkdown()).toBe('| a  |  b |\n| :- | -: |\n| 1  |  2 |\n')
    } finally {
      await editor.destroy()
    }
  })

  it('deleteTableRow keeps the cursor column after deletion', async () => {
    await setup(ALIGNED)
    try {
      placeCursor(editor, '4')
      expect(runCommand(deleteTableRow)).toBe(true)
      expect(editor.getMarkdown()).toBe('| a  |  b |\n| :- | -: |\n| 1  |  2 |\n')
      // Ruling-2 扩展（2026-10-17）：行删除后光标保持原列，不折叠到 col 0。
      const rect = selectedRect(editor.getView().state)
      expect(rect.top).toBe(1)
      expect(rect.left).toBe(1)
    } finally {
      await editor.destroy()
    }
  })

  it('deleteTableColumn deletes the cursor column', async () => {
    await setup(ALIGNED)
    try {
      placeCursor(editor, '2')
      expect(runCommand(deleteTableColumn)).toBe(true)
      expect(editor.getMarkdown()).toBe('| a  |\n| :- |\n| 1  |\n| 3  |\n')
    } finally {
      await editor.destroy()
    }
  })

  it('deleteTableRow refuses to delete the header row', async () => {
    await setup(ALIGNED)
    try {
      placeCursor(editor, 'a')
      expect(runCommand(deleteTableRow)).toBe(false)
      expect(editor.getMarkdown()).toBe(SERIALIZED_ALIGNED)
    } finally {
      await editor.destroy()
    }
  })

  it('deleteTableColumn refuses to delete the last column', async () => {
    await setup('| a |\n| - |\n| 1 |\n')
    try {
      placeCursor(editor, 'a')
      expect(runCommand(deleteTableColumn)).toBe(false)
      expect(editor.getMarkdown()).toBe('| a |\n| - |\n| 1 |\n')
    } finally {
      await editor.destroy()
    }
  })

  it('all commands return false outside tables', async () => {
    await setup('plain paragraph\n')
    try {
      placeCursor(editor, 'plain paragraph')
      const commands: [string, TableCommand][] = [
        ['addRowAbove', addRowAbove],
        ['addRowBelow', addRowBelow],
        ['addColumnLeft', addColumnLeft],
        ['addColumnRight', addColumnRight],
        ['deleteTableRow', deleteTableRow],
        ['deleteTableColumn', deleteTableColumn],
      ]
      for (const [name, cmd] of commands) {
        expect(runCommand(cmd), name).toBe(false)
      }
    } finally {
      await editor.destroy()
    }
  })

  it('colwidth is view-only and never serialized', async () => {
    await setup(ALIGNED)
    try {
      const view = editor.getView()
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'table_cell' || node.type.name === 'table_header') {
          view.dispatch(
            view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: [123] }),
          )
        }
        return true
      })
      expect(editor.getMarkdown()).toBe(SERIALIZED_ALIGNED)
    } finally {
      await editor.destroy()
    }
  })
})
