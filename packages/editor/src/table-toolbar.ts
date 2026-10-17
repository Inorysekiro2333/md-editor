import { $prose } from '@milkdown/kit/utils'
import type { Ctx } from '@milkdown/kit/ctx'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { isInTable, selectedRect } from '@milkdown/prose/tables'
import {
  addColumnLeft,
  addColumnRight,
  addRowAbove,
  addRowBelow,
  deleteTableColumn,
  deleteTableRow,
  type TableCommand,
} from './table-commands'

export const tableToolbarPluginKey = new PluginKey('md-table-toolbar')

const BUTTONS: Array<{ id: string; label: string; cmd: TableCommand }> = [
  { id: 'table-toolbar-row-above', label: '↑行', cmd: addRowAbove },
  { id: 'table-toolbar-row-below', label: '↓行', cmd: addRowBelow },
  { id: 'table-toolbar-col-left', label: '←列', cmd: addColumnLeft },
  { id: 'table-toolbar-col-right', label: '→列', cmd: addColumnRight },
  { id: 'table-toolbar-row-delete', label: '删行', cmd: deleteTableRow },
  { id: 'table-toolbar-col-delete', label: '删列', cmd: deleteTableColumn },
]

export const tableToolbar = $prose((ctx: Ctx) => {
  let toolbar: HTMLElement | null = null
  let view: EditorView | null = null
  const run = (cmd: TableCommand): void => {
    if (!view) return
    view.focus()
    cmd(ctx, view.state, (tr) => view?.dispatch(tr))
  }
  return new Plugin({
    key: tableToolbarPluginKey,
    view(editorView: EditorView) {
      view = editorView
      toolbar = document.createElement('div')
      toolbar.className = 'md-table-toolbar'
      toolbar.setAttribute('data-testid', 'table-toolbar')
      for (const b of BUTTONS) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.textContent = b.label
        btn.setAttribute('data-testid', b.id)
        // 防止点击工具栏时抢走编辑器选区
        btn.addEventListener('mousedown', (e) => e.preventDefault())
        btn.addEventListener('click', () => run(b.cmd))
        toolbar.appendChild(btn)
      }
      editorView.dom.parentElement?.appendChild(toolbar)
      const sync = (v: EditorView): void => {
        if (!toolbar) return
        if (!v.editable || !isInTable(v.state)) {
          toolbar.style.display = 'none'
          return
        }
        toolbar.style.display = 'flex'
        // jsdom 下 getBoundingClientRect 返回 0，跳过定位即可，不抛错
        const rect = selectedRect(v.state)
        const dom = v.domAtPos(rect.tableStart)
        const tableEl =
          (dom.node instanceof Element ? dom.node : dom.node.parentElement)?.querySelector(
            'table',
          ) ?? null
        const box = tableEl?.getBoundingClientRect()
        if (box && box.width > 0) {
          toolbar.style.left = `${Math.round(box.right - toolbar.offsetWidth)}px`
          toolbar.style.top = `${Math.round(box.top - 28)}px`
        }
      }
      sync(editorView)
      return {
        update(v: EditorView) {
          sync(v)
        },
        destroy() {
          toolbar?.remove()
          toolbar = null
          view = null
        },
      }
    },
  })
})
