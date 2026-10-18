import { $prose } from '@milkdown/kit/utils'
import type { Ctx } from '@milkdown/kit/ctx'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { isInTable } from '@milkdown/prose/tables'
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

const BUTTONS: Array<{ id: string; label: string; title: string; cmd: TableCommand }> = [
  { id: 'table-toolbar-row-above', label: '↑行', title: '在上方插入行', cmd: addRowAbove },
  { id: 'table-toolbar-row-below', label: '↓行', title: '在下方插入行', cmd: addRowBelow },
  { id: 'table-toolbar-col-left', label: '←列', title: '在左侧插入列', cmd: addColumnLeft },
  { id: 'table-toolbar-col-right', label: '→列', title: '在右侧插入列', cmd: addColumnRight },
  { id: 'table-toolbar-row-delete', label: '删行', title: '删除当前行', cmd: deleteTableRow },
  { id: 'table-toolbar-col-delete', label: '删列', title: '删除当前列', cmd: deleteTableColumn },
]

export const tableToolbar = $prose((ctx: Ctx) => {
  let toolbar: HTMLElement | null = null
  let view: EditorView | null = null
  let anchor: HTMLElement | null = null
  let hoverCount = 0
  let editorViewHost: HTMLElement | null = null
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
        btn.title = b.title
        btn.setAttribute('data-testid', b.id)
        // 防止点击工具栏时抢走编辑器选区
        btn.addEventListener('mousedown', (e) => e.preventDefault())
        btn.addEventListener('click', () => run(b.cmd))
        toolbar.appendChild(btn)
      }
      editorViewHost = editorView.dom.parentElement ?? null
      editorViewHost?.appendChild(toolbar)
      // 工具条吸附到表格右上角：宿主是 .tableWrapper（CSS 相对定位），
      // 表格 hover 或光标在表内任一条件即显示。
      const show = (): void => {
        hoverCount += 1
        if (view && isInTable(view.state)) sync(view)
        else if (toolbar) toolbar.style.display = 'flex'
      }
      const hide = (): void => {
        hoverCount = Math.max(0, hoverCount - 1)
        if (hoverCount === 0 && view && !isInTable(view.state) && toolbar) {
          toolbar.style.display = 'none'
        }
      }
      const sync = (v: EditorView): void => {
        if (!toolbar) return
        const inTable = isInTable(v.state)
        if (!v.editable || (!inTable && hoverCount === 0)) {
          toolbar.style.display = 'none'
          return
        }
        toolbar.style.display = 'flex'
        // 吸附到表格容器右上角，CSS 相对定位。不依赖 selectedRect（纯光标选区下
        // 某些 Milkdown 装配会抛错），直接沿选区祖先找 table 节点。
        let tableStart = -1
        const $from = v.state.selection.$from
        for (let depth = $from.depth; depth >= 0; depth -= 1) {
          const node = $from.node(depth)
          if (node.type.name === 'table') {
            tableStart = $from.before(depth)
            break
          }
        }
        const dom = tableStart >= 0 ? v.domAtPos(tableStart) : null
        const tableEl =
          (dom && dom.node instanceof Element ? dom.node : dom?.node.parentElement)?.querySelector(
            'table',
          ) ?? null
        // hover 挂在表格元素上（表格 hover 或光标在表内任一条件即显示）；
        // 工具条本身必须留在可编辑区之外，绝不能 appendChild 进 ProseMirror 根，
        // 否则会被 PM 当作文档变更解析掉。
        if (tableEl && tableEl !== anchor) {
          anchor?.removeEventListener('mouseenter', show)
          anchor?.removeEventListener('mouseleave', hide)
          anchor = tableEl
          anchor.addEventListener('mouseenter', show)
          anchor.addEventListener('mouseleave', hide)
        }
        // 工具条自身也算 hover 区域（贴在表格上时防止 mouseleave 抖动）
        if (toolbar && !toolbar.dataset.hoverBound) {
          toolbar.dataset.hoverBound = '1'
          toolbar.addEventListener('mouseenter', show)
          toolbar.addEventListener('mouseleave', hide)
        }
        // 吸附表格右上角：相对编辑器容器（.milkdown，CSS position:relative）定位。
        // jsdom 下 getBoundingClientRect 返回 0，跳过定位即可，不抛错。
        const box = tableEl?.getBoundingClientRect()
        const host = editorViewHost?.getBoundingClientRect()
        if (box && host && box.width > 0) {
          // 默认悬浮在表格右上角上方；空间不足（表格贴近视口/文档顶部）时
          // 贴在表格内右上角，避免被顶栏遮挡。
          const above = box.top >= 44 && box.top - host.top >= 34
          const inset = above ? -32 : 4
          toolbar.style.right = `${Math.round(host.right - box.right)}px`
          toolbar.style.top = `${Math.round(box.top - host.top + inset)}px`
        }
      }
      sync(editorView)
      return {
        update(v: EditorView) {
          sync(v)
        },
        destroy() {
          anchor?.removeEventListener('mouseenter', show)
          anchor?.removeEventListener('mouseleave', hide)
          toolbar?.remove()
          toolbar = null
          view = null
          anchor = null
          hoverCount = 0
          editorViewHost = null
        },
      }
    },
  })
})
