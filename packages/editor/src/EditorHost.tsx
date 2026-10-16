import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  parserCtx,
  prosePluginsCtx,
  rootCtx,
} from '@milkdown/kit/core'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { getMarkdown } from '@milkdown/kit/utils'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { useEffect, useMemo, useRef } from 'react'
import { editorInputRules } from './input-rules'
import {
  buildSessionHistory,
  loadHistory,
  restoreSessionHistory,
  saveHistory,
  sessionRecorderPlugin,
} from './session-history'
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
  const restoredRef = useRef(false)

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

  const { get, loading } = useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, initialMarkdown)
          ctx.update(prosePluginsCtx, (ps) => [...ps, sessionRecorderPlugin])
          ctx.get(listenerCtx).markdownUpdated((ctx) => {
            sync.schedule()
            // 每次文档更新即刷新会话撤销栈记录（卸载时 editor 可能已被 Milkdown 销毁）
            saveHistory(
              docId,
              buildSessionHistory(ctx.get(editorViewCtx).state, initialMarkdownRef.current),
            )
          })
        })
        .use(commonmark)
        .use(editorInputRules)
        .use(gfm)
        .use(history)
        .use(listener),
    [docId],
  )

  // editor.create() 是异步的：loading 变为 false 后 get() 才非空，
  // 在这里恢复会话撤销栈（同一渲染进程内的内存 Map）。
  useEffect(() => {
    if (loading) return
    const editor = get()
    if (!editor || restoredRef.current) return
    restoredRef.current = true
    const record = loadHistory(docId)
    if (!record) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      if (record.baseMarkdown !== initialMarkdownRef.current) {
        // 外部重载等场景：初始内容已变，先重置为撤销栈的基线内容再重放
        const base = ctx.get(parserCtx)(record.baseMarkdown)
        if (base) {
          view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, base))
        }
      }
      restoreSessionHistory(record, view)
    })
  }, [get, loading, docId])

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
