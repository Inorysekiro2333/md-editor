import { $prose } from '@milkdown/kit/utils'
import { keymap } from '@milkdown/kit/prose/keymap'
import { TextSelection } from '@milkdown/kit/prose/state'

/**
 * 表格管道规则：在段落末尾键入 `| a | b |` 后按 Enter，
 * 将该段替换为 GFM 表格（首行即表头）。
 * Milkdown gfm 自带的表格 input rule 由行尾空格触发，Enter 不生效，
 * 故此处用 keymap 补齐，复用 gfm 注册的 table/table_row/table_header 节点。
 */
export const editorInputRules = $prose(() => {
  return keymap({
    Enter: (state, dispatch) => {
      const { $from, empty } = state.selection
      if (!empty || !$from.parent.isTextblock) return false
      if ($from.parentOffset !== $from.parent.content.size) return false
      const match = /^\|(.+)\|$/.exec($from.parent.textContent)
      if (!match) return false
      const table = state.schema.nodes.table
      const row = state.schema.nodes.table_row
      const header = state.schema.nodes.table_header
      const paragraph = state.schema.nodes.paragraph
      if (!table || !row || !header) return false
      if (!dispatch) return true
      const cells = match[1].split(/(?<!\\)\|/).map((raw) => {
        const text = raw.replaceAll('\\|', '|').trim()
        return header.create(null, paragraph.create(null, text ? state.schema.text(text) : null))
      })
      const tableNode = table.create(null, [row.create(null, cells)])
      const tr = state.tr.replaceWith($from.before(1), $from.after(1), tableNode)
      tr.setSelection(TextSelection.near(tr.doc.resolve($from.before(1)), 1)).scrollIntoView()
      dispatch(tr)
      return true
    },
  })
})
