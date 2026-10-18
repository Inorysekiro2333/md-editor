import { toggleMark, wrapIn } from '@milkdown/prose/commands'
import { TextSelection } from '@milkdown/prose/state'
import { wrapInList } from '@milkdown/prose/schema-list'
import { keymap } from '@milkdown/prose/keymap'
import { $prose } from '@milkdown/kit/utils'
import type { Node as PMNode, Schema } from '@milkdown/prose/model'
import type { EditorState, Transaction } from '@milkdown/prose/state'

export type FormatCommandName =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'inlineCode'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'orderedList'
  | 'bulletList'
  | 'blockquote'
  | 'insertTable'

type PMCommand = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean

/**
 * 统一的格式化命令分发（纯 ProseMirror，作用于 Milkdown Doc）。
 * 事务经既有 sync 插件收敛回 Markdown Buffer（铁律 2）。
 */
export function runFormatCommand(
  view: { state: EditorState; dispatch(tr: Transaction): void },
  name: FormatCommandName,
): boolean {
  const { state, dispatch } = view
  const schema = state.schema
  const run = (command: PMCommand): boolean => command(state, dispatch)

  switch (name) {
    case 'bold':
      return schema.marks.strong ? run(toggleMark(schema.marks.strong)) : false
    case 'italic':
      return schema.marks.emphasis ? run(toggleMark(schema.marks.emphasis)) : false
    case 'strikethrough':
      return schema.marks.strike_through ? run(toggleMark(schema.marks.strike_through)) : false
    case 'inlineCode':
      return schema.marks.inlineCode ? run(toggleMark(schema.marks.inlineCode)) : false
    case 'h1':
    case 'h2':
    case 'h3': {
      const level = Number(name.slice(1))
      const heading = schema.nodes.heading
      const paragraph = schema.nodes.paragraph
      if (!heading || !paragraph) return false
      return run((s, d) => {
        if (!d) return true
        const targets: Array<{ pos: number; node: PMNode }> = []
        for (const range of s.selection.ranges) {
          s.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
            if (node.type === heading || node.type === paragraph) {
              targets.push({ pos, node })
            }
          })
        }
        if (targets.length === 0) return false
        // Single transaction: multi-block selections must not let later
        // per-block transactions (each based on the same old state) overwrite
        // earlier ones.
        const tr = s.tr
        for (const { pos, node } of targets) {
          // nodesBetween reports the position *before* the block node; move
          // inside it so setBlockType can resolve the block range.
          const inner = pos + 1
          if (node.type === heading && node.attrs.level === level) {
            tr.setBlockType(inner, inner, paragraph)
          } else {
            tr.setBlockType(inner, inner, heading, { level })
          }
        }
        d(tr)
        return true
      })
    }
    case 'orderedList':
      return schema.nodes.ordered_list ? run(wrapInList(schema.nodes.ordered_list)) : false
    case 'bulletList':
      return schema.nodes.bullet_list ? run(wrapInList(schema.nodes.bullet_list)) : false
    case 'blockquote':
      return schema.nodes.blockquote ? run(wrapIn(schema.nodes.blockquote)) : false
    case 'insertTable': {
      const tableType = schema.nodes.table
      if (!tableType || insideTable(state.selection.$from)) return false
      // Record the selection before replacing so the caret can be located via
      // the transaction's own mapping — never by scanning for the first table
      // in the document (an existing earlier table would steal the caret).
      const before = state.selection.from
      const tr = state.tr.replaceSelectionWith(buildTable(schema)).scrollIntoView()
      const mapped = tr.mapping.map(before, -1)
      const resolved = tr.doc.resolve(mapped)
      const tableAt = (pos: number): number =>
        pos >= 0 && pos <= tr.doc.content.size && tr.doc.nodeAt(pos)?.type.name === 'table'
          ? pos
          : -1
      let tablePos = tableAt(mapped)
      if (tablePos < 0 && resolved.nodeBefore?.type.name === 'table') {
        tablePos = mapped - resolved.nodeBefore.nodeSize
      }
      if (tablePos < 0) {
        // The mapped position may sit inside a text block adjacent to the
        // inserted table; walk outward to find the sibling table node.
        for (let d = resolved.depth; d >= 0 && tablePos < 0; d -= 1) {
          // resolved.after/before throw at the top level when nothing follows.
          try {
            tablePos = tableAt(resolved.after(d))
          } catch {
            /* nothing after this level */
          }
          if (tablePos < 0) {
            try {
              const edge = tr.doc.resolve(resolved.before(d))
              if (edge.nodeBefore?.type.name === 'table') {
                tablePos = edge.pos - edge.nodeBefore.nodeSize
              }
            } catch {
              /* nothing before this level */
            }
          }
        }
      }
      if (tablePos < 0) return false
      // Resolve the first header cell's start; TextSelection.near lands on
      // its inner paragraph so the caret is visible and typable.
      tr.setSelection(TextSelection.near(tr.doc.resolve(tablePos + 2)))
      dispatch(tr)
      return true
    }
    default:
      return false
  }
}

function insideTable(resolved: { depth: number; node(depth: number): PMNode }): boolean {
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === 'table') return true
  }
  return false
}

function buildTable(schema: Schema): PMNode {
  const tableType = schema.nodes.table
  const rowType = schema.nodes.table_row
  const headerType = schema.nodes.table_header
  const cellType = schema.nodes.table_cell
  if (!tableType || !rowType || !headerType || !cellType) {
    throw new Error('table schema nodes are missing')
  }
  const empty = (type: PMNode['type']): PMNode => type.createAndFill() ?? type.create()
  const headerRow = rowType.create(undefined, [
    empty(headerType),
    empty(headerType),
    empty(headerType),
  ])
  const dataRow = rowType.create(undefined, [empty(cellType), empty(cellType), empty(cellType)])
  return tableType.create(undefined, [headerRow, dataRow, dataRow])
}

/**
 * Ctrl+B / Ctrl+I / Ctrl+Shift+X / Ctrl+E 统一注册（M5.x 工具栏同步补齐）。
 *
 * 审查结论（2026-10-18）：Milkdown commonmark 内置 keymap 已含 Mod-b（strikeout 等同理），
 * 本 keymap 注册在后故优先命中，无双 toggle；该行为依赖注册顺序，移除/改动前必须核对内置绑定，
 * 避免未来调整装配顺序造成回归。
 */
export const formattingKeymap = $prose(() =>
  keymap({
    'Mod-b': (state, dispatch) =>
      runFormatCommand({ state, dispatch: dispatch ?? ((): void => {}) }, 'bold'),
    'Mod-i': (state, dispatch) =>
      runFormatCommand({ state, dispatch: dispatch ?? ((): void => {}) }, 'italic'),
    'Mod-Shift-x': (state, dispatch) =>
      runFormatCommand({ state, dispatch: dispatch ?? ((): void => {}) }, 'strikethrough'),
    'Mod-e': (state, dispatch) =>
      runFormatCommand({ state, dispatch: dispatch ?? ((): void => {}) }, 'inlineCode'),
  }),
)
