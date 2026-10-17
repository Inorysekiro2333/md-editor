import type { Ctx } from '@milkdown/kit/ctx'
import { addRowWithAlignment } from '@milkdown/kit/preset/gfm'
import type { EditorState, Transaction } from '@milkdown/prose/state'
import {
  CellSelection,
  addColumnAfter,
  addColumnBefore,
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
  if (dispatch) {
    const rect = selectedRect(state)
    dispatch(addRowWithAlignment(ctx, state.tr, rect, rect.top))
  }
  return true
}

export const addRowBelow: TableCommand = (ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  if (dispatch) {
    const rect = selectedRect(state)
    dispatch(addRowWithAlignment(ctx, state.tr, rect, rect.bottom))
  }
  return true
}

export const addColumnLeft: TableCommand = (_ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  return addColumnBefore(state, dispatch)
}

export const addColumnRight: TableCommand = (_ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  return addColumnAfter(state, dispatch)
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
  return deleteRow(fakeState, dispatch)
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
