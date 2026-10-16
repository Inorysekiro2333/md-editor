// @vitest-environment jsdom
import { TextSelection } from '@milkdown/prose/state'
import { describe, expect, it } from 'vitest'
import { applySelectionOffsets, selectionOffsetsFromView } from './EditorHost'
import { createTestEditor } from './testing/create-test-editor'

const md = '# 标题\n\n正文**加粗**继续\n\n```ts\nconst a = 1\n```\n'

function textPos(doc: import('@milkdown/prose/model').Node, text: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(text)) {
      found = pos + node.text.indexOf(text)
      return false
    }
    return true
  })
  if (found === -1) throw new Error(`text not found: ${text}`)
  return found
}

describe('mode switch selection round-trip (PM side)', () => {
  it('restores exact anchor/head at heading middle', async () => {
    const te = await createTestEditor(md)
    try {
      const view = te.getView()
      const pos = textPos(view.state.doc, '标') + 1
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
      const captured = selectionOffsetsFromView(md, view)
      applySelectionOffsets(view, md, captured.anchor, captured.head)
      expect(selectionOffsetsFromView(md, view)).toEqual(captured)
      expect(view.state.selection.anchor).toBe(pos)
    } finally {
      await te.destroy()
    }
  })

  it('restores exact anchor/head inside bold text', async () => {
    const te = await createTestEditor(md)
    try {
      const view = te.getView()
      const pos = textPos(view.state.doc, '加粗') + 1
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
      const captured = selectionOffsetsFromView(md, view)
      applySelectionOffsets(view, md, captured.anchor, captured.head)
      expect(selectionOffsetsFromView(md, view)).toEqual(captured)
      expect(view.state.selection.anchor).toBe(pos)
    } finally {
      await te.destroy()
    }
  })

  it('restores exact anchor/head inside fenced code block', async () => {
    const te = await createTestEditor(md)
    try {
      const view = te.getView()
      const pos = textPos(view.state.doc, 'const a = 1') + 2
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
      const captured = selectionOffsetsFromView(md, view)
      applySelectionOffsets(view, md, captured.anchor, captured.head)
      expect(selectionOffsetsFromView(md, view)).toEqual(captured)
      expect(view.state.selection.anchor).toBe(pos)
    } finally {
      await te.destroy()
    }
  })
})
