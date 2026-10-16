import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { useEffect, useMemo, useRef } from 'react'
import { createMarkdownSync } from './sync'

export interface SourceEditorHandle {
  getText(): string
  flushNow(): void
  getSelectionOffsets(): { anchor: number; head: number }
  setSelectionOffsets(anchor: number, head: number): void
  focus(): void
  getScrollRatio(): number
}

export interface SourceEditorProps {
  initialMarkdown: string
  onMarkdownChange(markdown: string): void
  onReady?(handle: SourceEditorHandle): void
  initialScrollRatio?: number
}

export function SourceEditor(props: SourceEditorProps): JSX.Element {
  const { initialMarkdown, initialScrollRatio } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 与 EditorHost 同契约：initialMarkdown 只在 mount 时读取一次，
  // onMarkdownChange 上抛后由 App 更新 Buffer，父组件重渲染不得重建编辑器。
  const initialMarkdownRef = useRef(initialMarkdown)
  const onMarkdownChangeRef = useRef(props.onMarkdownChange)
  const onReadyRef = useRef(props.onReady)

  useEffect(() => {
    onMarkdownChangeRef.current = props.onMarkdownChange
    onReadyRef.current = props.onReady
  })

  // 300ms 防抖窗口与 Milkdown 侧（EditorHost）一致；
  // pending 窗口内的 flush 不能因 inline 回调重建而被 dispose 丢弃。
  const sync = useMemo(
    () =>
      createMarkdownSync({
        delayMs: 300,
        serialize: () => viewRef.current?.state.doc.toString() ?? initialMarkdownRef.current,
        onFlush: (markdown) => onMarkdownChangeRef.current(markdown),
      }),
    [],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      state: EditorState.create({
        doc: initialMarkdownRef.current,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          markdown({ codeLanguages: languages }),
          syntaxHighlighting(defaultHighlightStyle),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) sync.schedule()
          }),
        ],
      }),
      parent: host,
    })
    viewRef.current = view

    // Ruling-4：滚动恢复采用 scrollTop/scrollHeight 比例的最小版本。
    if (initialScrollRatio != null && view.scrollDOM.scrollHeight > 0) {
      view.scrollDOM.scrollTop = initialScrollRatio * view.scrollDOM.scrollHeight
    }

    const handle: SourceEditorHandle = {
      getText: () => view.state.doc.toString(),
      flushNow: () => sync.flushNow(),
      getSelectionOffsets: () => {
        const selection = view.state.selection.main
        return { anchor: selection.anchor, head: selection.head }
      },
      setSelectionOffsets: (anchor, head) => {
        const max = view.state.doc.length
        view.dispatch({
          selection: EditorSelection.single(
            Math.min(Math.max(anchor, 0), max),
            Math.min(Math.max(head, 0), max),
          ),
        })
      },
      focus: () => view.focus(),
      getScrollRatio: () => {
        const scrollHeight = view.scrollDOM.scrollHeight
        if (scrollHeight === 0) return 0
        return view.scrollDOM.scrollTop / scrollHeight
      },
    }
    onReadyRef.current?.(handle)

    return () => {
      sync.dispose()
      view.destroy()
      viewRef.current = null
    }
  }, [initialScrollRatio, sync])

  return <div ref={hostRef} className="md-source-editor" />
}
