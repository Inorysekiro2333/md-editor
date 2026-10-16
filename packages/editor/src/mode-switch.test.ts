// @vitest-environment jsdom
import { TextSelection } from '@milkdown/prose/state'
import { describe, expect, it } from 'vitest'
import { markdownOffsetToPmPos } from './cursor-map'
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

  it('degrades a block-boundary offset to the next block start (architecture 3.4)', async () => {
    // md offset 5 = 标题行末（块级边界）：既不在标题文本内，也不在段落文本内
    const boundaryMd = '# 标题\n\n段落\n'
    const te = await createTestEditor(boundaryMd)
    try {
      const view = te.getView()
      const boundaryOffset = boundaryMd.indexOf('段落') - 1
      applySelectionOffsets(view, boundaryMd, boundaryOffset, boundaryOffset)
      const restored = selectionOffsetsFromView(boundaryMd, view)
      // 恢复点必须是下一块（段落）块首，而不是前一块末尾
      expect(view.state.selection.anchor).toBe(textPos(view.state.doc, '段'))
      // 映射回 md offset 后落在段落文本起点
      expect(restored.anchor).toBe(boundaryMd.indexOf('段'))
      // 边界 offset 本身按「最近祖先」语义退化（非 exact 文本内位置）
      expect(markdownOffsetToPmPos(boundaryMd, view.state.doc, boundaryOffset).accuracy).toBe(
        'ancestor',
      )
    } finally {
      await te.destroy()
    }
  })
})
