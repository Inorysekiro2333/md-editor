/**
 * cursor-notify：光标变化通知插件（EditorHost 用 PM 插件工厂）。
 *
 * 语义（M3 计划 Task 3 写死）：
 * - getNotify() 返回 `{ cb, buffer }` 或 null；cb 收到 Markdown offset（Buffer 坐标），
 *   经 pmPosToMarkdownOffset 从 PM anchor 投影，与 cursor-map 同一映射管线。
 * - 150ms 节流：窗口外立即发射（leading），窗口内不重复发射，
 *   窗口结束时补发最后一次位置（trailing），保证快速移动后最终光标可达。
 * - 选区或文档变化都视为光标变化（键入会移动 anchor）。
 * - buffer 在发射时经 getNotify() 现取，避免闭包旧值。
 */
import { Plugin, PluginKey } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import { pmPosToMarkdownOffset } from './cursor-map'

export interface CursorNotifyState {
  cb: ((offset: number) => void) | null
  buffer: string
}

export const cursorNotifyPluginKey = new PluginKey<Record<string, never>>('cursor-notify')

const THROTTLE_MS = 150

export function createCursorNotifyPlugin(getNotify: () => CursorNotifyState | null): Plugin {
  let lastEmit = 0
  let trailingTimer: ReturnType<typeof setTimeout> | null = null
  let trailingAnchor: number | null = null

  const emitNow = (view: EditorView, anchor: number): void => {
    const notify = getNotify()
    if (notify === null || notify.cb === null) return
    notify.cb(pmPosToMarkdownOffset(notify.buffer, view.state.doc, anchor))
  }

  return new Plugin({
    key: cursorNotifyPluginKey,
    view: (view) => ({
      update: (updated, prevState) => {
        if (
          updated.state.selection === prevState.selection &&
          updated.state.doc === prevState.doc
        ) {
          return
        }
        const anchor = updated.state.selection.anchor
        const now = Date.now()
        const elapsed = now - lastEmit
        if (elapsed >= THROTTLE_MS) {
          lastEmit = now
          if (trailingTimer !== null) {
            clearTimeout(trailingTimer)
            trailingTimer = null
          }
          trailingAnchor = null
          emitNow(view, anchor)
          return
        }
        trailingAnchor = anchor
        if (trailingTimer === null) {
          trailingTimer = setTimeout(() => {
            trailingTimer = null
            if (trailingAnchor === null) return
            const pending = trailingAnchor
            trailingAnchor = null
            lastEmit = Date.now()
            emitNow(view, pending)
          }, THROTTLE_MS - elapsed)
        }
      },
      destroy: () => {
        if (trailingTimer !== null) {
          clearTimeout(trailingTimer)
          trailingTimer = null
        }
      },
    }),
  })
}
