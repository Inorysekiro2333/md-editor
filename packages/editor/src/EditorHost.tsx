import { defaultValueCtx, Editor, rootCtx } from '@milkdown/kit/core'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { getMarkdown } from '@milkdown/kit/utils'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { useEffect, useMemo, useRef } from 'react'
import { editorInputRules } from './input-rules'
import { createMarkdownSync } from './sync'

export interface EditorHandle {
  getMarkdown(): string
  flushNow(): void
}

export interface EditorHostProps {
  docId: string
  initialMarkdown: string
  onMarkdownChange(markdown: string): void
  onReady?(handle: EditorHandle): void
}

function EditorHostInner(props: EditorHostProps) {
  const { docId, initialMarkdown, onMarkdownChange, onReady } = props
  const handleRef = useRef<EditorHandle | null>(null)
  const initialMarkdownRef = useRef(initialMarkdown)
  const onMarkdownChangeRef = useRef(onMarkdownChange)

  useEffect(() => {
    initialMarkdownRef.current = initialMarkdown
    onMarkdownChangeRef.current = onMarkdownChange
  }, [initialMarkdown, onMarkdownChange])

  // 同步器只创建一次：App 传入的 inline 回调会随父组件重渲染重建，
  // 若直接依赖 props，重渲染会 dispose 掉尚在 300ms 防抖窗口内的 pending flush，
  // 导致排队中的写入被静默丢弃（Ctrl+S 写不出任何内容）。
  const sync = useMemo(
    () =>
      createMarkdownSync({
        delayMs: 300,
        serialize: () => handleRef.current?.getMarkdown() ?? initialMarkdownRef.current,
        onFlush: (markdown) => onMarkdownChangeRef.current(markdown),
      }),
    [],
  )

  useEffect(() => () => sync.dispose(), [sync])

  const { get } = useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, initialMarkdown)
          ctx.get(listenerCtx).markdownUpdated(() => {
            sync.schedule()
          })
        })
        .use(commonmark)
        .use(editorInputRules)
        .use(gfm)
        .use(history)
        .use(listener),
    [docId],
  )

  useEffect(() => {
    const handle: EditorHandle = {
      getMarkdown: () => {
        const editor = get()
        return editor ? editor.action(getMarkdown()) : initialMarkdownRef.current
      },
      flushNow: () => sync.flushNow(),
    }
    handleRef.current = handle
    onReady?.(handle)
  }, [get, onReady, sync])

  return <Milkdown />
}

export function EditorHost(props: EditorHostProps) {
  return (
    <MilkdownProvider>
      <EditorHostInner {...props} />
    </MilkdownProvider>
  )
}
