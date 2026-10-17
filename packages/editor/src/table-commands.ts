import type { Ctx } from '@milkdown/kit/ctx'
import { addRowWithAlignment } from '@milkdown/kit/preset/gfm'
import type { EditorState, Transaction } from '@milkdown/prose/state'
import { TextSelection } from '@milkdown/prose/state'
import type { Node as PMNode } from '@milkdown/prose/model'
import {
  CellSelection,
  TableMap,
  addColumn,
  deleteColumn,
  deleteRow,
  isInTable,
  selectedRect,
} from '@milkdown/prose/tables'

export type TableCommand = (
  ctx: Ctx,
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
) => boolean

interface TableRect {
  table: PMNode
  tableStart: number
  map: TableMap
  top: number
  left: number
  right: number
  bottom: number
}

function rowPosAt(rect: TableRect, row: number): number {
  return Array(row)
    .fill(0)
    .reduce((acc, _, i) => acc + rect.table.child(i).nodeSize, rect.tableStart)
}

// 单事务：插入新行后把光标移入新行第一个单元格（Ruling-2，2026-10-17）。
function cursorIntoRow(tr: Transaction, rowPos: number): void {
  tr.setSelection(TextSelection.near(tr.doc.resolve(rowPos + 1), 1))
}

// 单事务：插入新列后把光标移入光标行的新列单元格（Ruling-2，2026-10-17）。
function cursorIntoColumn(tr: Transaction, rect: TableRect, col: number): void {
  const table = tr.doc.nodeAt(rect.tableStart - 1)
  if (!table) return
  const map = TableMap.get(table)
  const cellPos = rect.tableStart + map.positionAt(rect.top, col, table)
  tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 1), 1))
}

function rowSelection(state: EditorState, row: number): CellSelection {
  const rect = selectedRect(state)
  const anchor = state.doc.resolve(rect.tableStart + rect.map.positionAt(row, 0, rect.table))
  const head = state.doc.resolve(
    rect.tableStart + rect.map.positionAt(row, rect.map.width - 1, rect.table),
  )
  return CellSelection.rowSelection(anchor, head)
}

function columnSelection(state: EditorState, col: number): CellSelection {
  const rect = selectedRect(state)
  const anchor = state.doc.resolve(rect.tableStart + rect.map.positionAt(0, col, rect.table))
  const head = state.doc.resolve(
    rect.tableStart + rect.map.positionAt(rect.map.height - 1, col, rect.table),
  )
  return CellSelection.colSelection(anchor, head)
}

export const addRowAbove: TableCommand = (ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  const rect = selectedRect(state)
  // Ruling-5 (2026-10-17): refuse to insert above the header row, same
  // guard semantics as deleteTableRow (header row is protected).
  if (rect.top === 0) return false
  if (!dispatch) return true
  const rowPos = rowPosAt(rect, rect.top)
  const tr = addRowWithAlignment(ctx, state.tr, rect, rect.top)
  cursorIntoRow(tr, rowPos)
  dispatch(tr)
  return true
}

export const addRowBelow: TableCommand = (ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  if (!dispatch) return true
  const rect = selectedRect(state)
  const rowPos = rowPosAt(rect, rect.bottom)
  const tr = addRowWithAlignment(ctx, state.tr, rect, rect.bottom)
  cursorIntoRow(tr, rowPos)
  dispatch(tr)
  return true
}

export const addColumnLeft: TableCommand = (_ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  if (!dispatch) return true
  const rect = selectedRect(state)
  const tr = state.tr
  addColumn(tr, rect, rect.left)
  cursorIntoColumn(tr, rect, rect.left)
  dispatch(tr)
  return true
}

export const addColumnRight: TableCommand = (_ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  if (!dispatch) return true
  const rect = selectedRect(state)
  const tr = state.tr
  addColumn(tr, rect, rect.right)
  cursorIntoColumn(tr, rect, rect.right)
  dispatch(tr)
  return true
}

export const deleteTableRow: TableCommand = (_ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  const rect = selectedRect(state)
  if (rect.top === 0 || rect.map.height <= 1) return false
  const selection = rowSelection(state, rect.top)
  const tr = state.tr.setSelection(selection)
  // prosemirror-tables deleteRow reads state.selection/state.tr; single
  // transaction completes selection + deletion in one undo step.
  const fakeState = { doc: state.doc, tr, selection } as unknown as EditorState
  // Ruling-2 扩展（2026-10-17）：deleteRow 会把删除行内的选区折叠到下一行行首（col 0），
  // 这里把光标放回原列，保证后续 col-delete 仍作用于同一列。
  const wrappedDispatch = dispatch
    ? (t: Transaction) => {
        const table = t.doc.nodeAt(rect.tableStart - 1)
        if (table) {
          const map = TableMap.get(table)
          const row = Math.min(rect.top, map.height - 1)
          const col = Math.min(rect.left, map.width - 1)
          const cellPos = rect.tableStart + map.positionAt(row, col, table)
          t.setSelection(TextSelection.near(t.doc.resolve(cellPos + 1), 1))
        }
        dispatch(t)
      }
    : undefined
  return deleteRow(fakeState, wrappedDispatch)
}

export const deleteTableColumn: TableCommand = (_ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  const rect = selectedRect(state)
  if (rect.map.width <= 1) return false
  const selection = columnSelection(state, rect.left)
  const tr = state.tr.setSelection(selection)
  const fakeState = { doc: state.doc, tr, selection } as unknown as EditorState
  return deleteColumn(fakeState, dispatch)
}
