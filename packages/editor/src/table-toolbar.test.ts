// @vitest-environment jsdom
import { TextSelection } from '@milkdown/prose/state'
import { describe, expect, it } from 'vitest'
import { tableToolbar } from './table-toolbar'
import { createTestEditor, type TestEditor } from './testing/create-test-editor'

const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n'
// 实测值（2026-10-17 scratch）：新增空行的单元格 padding 为 3 空格
const ROW_BELOW_RESULT = '| a | b |\n| - | - |\n| 1 | 2 |\n|   |   |\n'

function placeCursor(editor: TestEditor, text: string): void {
  const view = editor.getView()
  const doc = view.state.doc
  let target = -1
  doc.descendants((node, pos) => {
    if (target < 0 && node.isTextblock && node.textContent === text) {
      target = pos
      return false
    }
    return true
  })
  if (target < 0) throw new Error(`textblock not found: ${text}`)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, target + 1)))
}

let editor: TestEditor

async function setup(markdown: string): Promise<void> {
  editor = await createTestEditor(markdown, [], [tableToolbar])
}

function toolbar(): Element | null {
  return document.querySelector('[data-testid="table-toolbar"]')
}

function toolbarVisible(): boolean {
  const el = toolbar()
  return el !== null && (el as HTMLElement).style.display !== 'none'
}

describe('table-toolbar', () => {
  it('renders and shows the toolbar when the cursor is inside a table', async () => {
    await setup(TABLE)
    try {
      placeCursor(editor, '1')
      const el = toolbar()
      // eslint-disable-next-line no-console
      expect(el).not.toBeNull()
      expect(toolbarVisible()).toBe(true)
      for (const id of [
        'table-toolbar-row-above',
        'table-toolbar-row-below',
        'table-toolbar-col-left',
        'table-toolbar-col-right',
        'table-toolbar-row-delete',
        'table-toolbar-col-delete',
      ]) {
        expect(document.querySelector(`[data-testid="${id}"]`)).not.toBeNull()
      }
    } finally {
      await editor.destroy()
    }
  })

  it('row-below button inserts a row below the cursor row', async () => {
    await setup(TABLE)
    try {
      placeCursor(editor, '1')
      const btn = document.querySelector<HTMLElement>('[data-testid="table-toolbar-row-below"]')
      expect(btn).not.toBeNull()
      btn?.click()
      expect(editor.getMarkdown()).toBe(ROW_BELOW_RESULT)
    } finally {
      await editor.destroy()
    }
  })

  it('hides the toolbar when the selection leaves the table', async () => {
    await setup(`${TABLE}\nplain paragraph\n`)
    try {
      placeCursor(editor, '1')
      expect(toolbarVisible()).toBe(true)
      placeCursor(editor, 'plain paragraph')
      expect(toolbarVisible()).toBe(false)
    } finally {
      await editor.destroy()
    }
  })

  it('row-delete on a header-only table is a no-op without throwing', async () => {
    await setup('| a |\n| - |\n')
    try {
      placeCursor(editor, 'a')
      expect(toolbarVisible()).toBe(true)
      const btn = document.querySelector<HTMLElement>('[data-testid="table-toolbar-row-delete"]')
      expect(() => btn?.click()).not.toThrow()
      expect(editor.getMarkdown()).toBe('| a |\n| - |\n')
    } finally {
      await editor.destroy()
    }
  })
})
