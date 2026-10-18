import { toggleMark, wrapIn } from '@milkdown/prose/commands'
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
        for (const { pos, node } of targets) {
          if (node.type === heading && node.attrs.level === level) {
            d(s.tr.setBlockType(pos, pos, paragraph))
          } else {
            d(s.tr.setBlockType(pos, pos, heading, { level }))
          }
        }
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
      dispatch(state.tr.replaceSelectionWith(buildTable(schema)).scrollIntoView())
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
