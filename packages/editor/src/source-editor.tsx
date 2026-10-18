import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { useEffect, useMemo, useRef } from 'react'
import { createMarkdownSync } from './sync'
import { runSourceFormatCommand } from './source-format-commands'
import type { FormatCommandArgs, FormatCommandName } from './format-commands'

export interface SourceEditorHandle {
  getText(): string
  flushNow(): void
  getSelectionOffsets(): { anchor: number; head: number }
  setSelectionOffsets(anchor: number, head: number): void
  focus(): void
  getScrollRatio(): number
  runCommand(name: FormatCommandName, args?: FormatCommandArgs): void
}

export interface SourceEditorProps {
  initialMarkdown: string
  onMarkdownChange(markdown: string): void
  onReady?(handle: SourceEditorHandle): void
  initialScrollRatio?: number
  // 大纲光标跟随：CM anchor 即 Markdown offset，直接回传（无需映射，节流由 App 统一 200ms）
  getBufferText?: () => string
  onCursorChange?(offset: number): void
}

export function SourceEditor(props: SourceEditorProps): JSX.Element {
  const { initialMarkdown, initialScrollRatio } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 与 EditorHost 同契约：initialMarkdown 只在 mount 时读取一次，
  // onMarkdownChange 上抛后由 App 更新 Buffer，父组件重渲染不得重建编辑器。
  const initialMarkdownRef = useRef(initialMarkdown)
  // R3 parked finding 修复：滚动初值只在 mount 读取一次，运行期变化不得重建 view / 重置 doc
  const initialScrollRatioRef = useRef(initialScrollRatio)
  const onMarkdownChangeRef = useRef(props.onMarkdownChange)
  const onCursorChangeRef = useRef(props.onCursorChange)
  const onReadyRef = useRef(props.onReady)

  useEffect(() => {
    onMarkdownChangeRef.current = props.onMarkdownChange
    onCursorChangeRef.current = props.onCursorChange
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
            // 选区或文档变化都视为光标变化；anchor 已是 Markdown offset
            if (!update.selectionSet && !update.docChanged) return
            onCursorChangeRef.current?.(update.state.selection.main.anchor)
          }),
        ],
      }),
      parent: host,
    })
    viewRef.current = view

    // Ruling-4：滚动恢复采用 scrollTop/scrollHeight 比例的最小版本。
    if (initialScrollRatioRef.current != null && view.scrollDOM.scrollHeight > 0) {
      view.scrollDOM.scrollTop = initialScrollRatioRef.current * view.scrollDOM.scrollHeight
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
      runCommand: (name, args) => {
        const v = viewRef.current
        if (v) runSourceFormatCommand(v, name, args)
      },
      getScrollRatio: () => {
        const scrollHeight = view.scrollDOM.scrollHeight
        if (scrollHeight === 0) return 0
        return view.scrollDOM.scrollTop / scrollHeight
      },
    }
    onReadyRef.current?.(handle)

    // e2e 调试专用，读取 CodeMirror 选区，无写能力。
    // 与 EditorHost 的 pmSelection 合并到同一 __mdEditorDebug 对象，避免互相覆盖。
    const debugWindow = window as unknown as { __mdEditorDebug?: Record<string, unknown> }
    debugWindow.__mdEditorDebug = {
      ...debugWindow.__mdEditorDebug,
      cmSelection: () => ({
        anchor: view.state.selection.main.anchor,
        hasFocus: view.hasFocus,
      }),
    }

    return () => {
      sync.dispose()
      view.destroy()
      viewRef.current = null
    }
  }, [sync])

  return <div ref={hostRef} className="md-source-editor" />
}
