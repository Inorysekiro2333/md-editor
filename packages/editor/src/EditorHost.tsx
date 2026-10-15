import { defaultValueCtx, Editor, rootCtx } from '@milkdown/kit/core'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { getMarkdown } from '@milkdown/kit/utils'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { useEffect, useMemo, useRef } from 'react'
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

  const sync = useMemo(
    () =>
      createMarkdownSync({
        delayMs: 300,
        serialize: () => handleRef.current?.getMarkdown() ?? initialMarkdown,
        onFlush: (markdown) => onMarkdownChange(markdown),
      }),
    [initialMarkdown, onMarkdownChange],
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
        .use(gfm)
        .use(history)
        .use(listener),
    [docId],
  )

  useEffect(() => {
    const handle: EditorHandle = {
      getMarkdown: () => {
        const editor = get()
        return editor ? editor.action(getMarkdown()) : initialMarkdown
      },
      flushNow: () => sync.flushNow(),
    }
    handleRef.current = handle
    onReady?.(handle)
  }, [get, initialMarkdown, onReady, sync])

  return <Milkdown />
}

export function EditorHost(props: EditorHostProps) {
  return (
    <MilkdownProvider>
      <EditorHostInner {...props} />
    </MilkdownProvider>
  )
}
