import {
  defaultValueCtx,
  pasteRulesCtx,
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
import { markdownOffsetToPmPos, pmPosToMarkdownOffset } from './cursor-map'
import type { Node as PMNode } from '@milkdown/prose/model'
import { TextSelection, type Transaction } from '@milkdown/prose/state'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { useEffect, useMemo, useRef } from 'react'
import { footnoteInputRules, footnoteUndefinedRefPlugin } from './footnotes'
import { editorInputRules } from './input-rules'
import { createPastePlugin, createPasteRule, type OnPasteAsset } from './paste'
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
  getSelectionOffsets(): { anchor: number; head: number } | null
  setSelectionOffsets(anchor: number, head: number): void
  focus(): void
  getScrollRatio(): number
}

export function selectionOffsetsFromView(
  markdown: string,
  view: { state: { doc: PMNode; selection: { anchor: number; head: number } } },
): { anchor: number; head: number } {
  return {
    anchor: pmPosToMarkdownOffset(markdown, view.state.doc, view.state.selection.anchor),
    head: pmPosToMarkdownOffset(markdown, view.state.doc, view.state.selection.head),
  }
}

export function applySelectionOffsets(
  view: { state: { doc: PMNode; tr: Transaction }; dispatch(tr: Transaction): void },
  markdown: string,
  anchor: number,
  head: number,
): void {
  const doc = view.state.doc
  const anchorPos = markdownOffsetToPmPos(markdown, doc, anchor).pos
  const headPos = markdownOffsetToPmPos(markdown, doc, head).pos
  // md offset 落在块级边界（如段落末尾后的空位）时 TextSelection.create 会抛错，
  // 退回到最近的合法 inline 位置，保证模式切换永不因光标恢复而崩溃。
  const nearPos = (pos: number): number => TextSelection.near(doc.resolve(pos), -1).anchor
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(doc, nearPos(anchorPos), nearPos(headPos))),
  )
}

export interface EditorHostProps {
  docId: string
  initialMarkdown: string
  onMarkdownChange(markdown: string): void
  onReady?(handle: EditorHandle): void
  onPasteAsset?: OnPasteAsset
  // 模式切换后的光标恢复：editor 异步创建完成后再应用并聚焦
  initialSelection?: { anchor: number; head: number } | null
  onSelectionApplied?(): void
}

function EditorHostInner(props: EditorHostProps) {
  const {
    docId,
    initialMarkdown,
    onMarkdownChange,
    onReady,
    onPasteAsset,
    initialSelection,
    onSelectionApplied,
  } = props
  const handleRef = useRef<EditorHandle | null>(null)
  const initialMarkdownRef = useRef(initialMarkdown)
  const onMarkdownChangeRef = useRef(onMarkdownChange)
  const restoredRef = useRef(false)
  const restoringRef = useRef(false)
  const baseMarkdownRef = useRef(initialMarkdown)
  const onPasteAssetRef = useRef(onPasteAsset)
  // 只在 mount 后 editor 创建完成时应用一次（模式切换的光标恢复）
  const initialSelectionRef = useRef(initialSelection)
  const selectionAppliedRef = useRef(false)
  const onSelectionAppliedRef = useRef(onSelectionApplied)

  useEffect(() => {
    onPasteAssetRef.current = onPasteAsset
  }, [onPasteAsset])

  // 粘贴扩展只在 editor 创建时注册一次；回调经 ref 读取最新值
  const pastePlugin = useMemo(() => createPastePlugin(() => onPasteAssetRef.current), [])
  const pasteRule = useMemo(() => createPasteRule(), [])

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
          ctx.update(prosePluginsCtx, (ps) => [...ps, sessionRecorderPlugin, pastePlugin])
          ctx.update(pasteRulesCtx, (rules) => [...rules, pasteRule])
          ctx.get(listenerCtx).markdownUpdated(() => {
            sync.schedule()
            // 每次文档更新即刷新会话撤销栈记录（卸载时 editor 可能已被 Milkdown 销毁）；
            // 基线永远是当前会话 record 的 baseMarkdown，恢复重放期间被 restoringRef 抑制，
            // 否则重放事务会把基线污染成新的 initialMarkdown
            if (!restoringRef.current) {
              saveHistory(
                docId,
                buildSessionHistory(ctx.get(editorViewCtx).state, baseMarkdownRef.current),
              )
            }
          })
        })
        .use(commonmark)
        .use(editorInputRules)
        .use(gfm)
        .use(footnoteUndefinedRefPlugin)
        .use(footnoteInputRules)
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
    restoringRef.current = true
    try {
      editor.action((ctx) => {
        restoreSessionHistory(record, ctx.get(editorViewCtx), {
          currentMarkdown: initialMarkdownRef.current,
          parseBase: (markdown) => ctx.get(parserCtx)(markdown),
        })
        // 恢复完成：以 record 的原始基线（而非新的 initialMarkdown）整体保存一次
        saveHistory(docId, buildSessionHistory(ctx.get(editorViewCtx).state, record.baseMarkdown))
      })
      baseMarkdownRef.current = record.baseMarkdown
    } finally {
      restoringRef.current = false
    }
  }, [get, loading, docId])

  useEffect(() => {
    if (loading) return
    const editor = get()
    if (!editor || selectionAppliedRef.current) return
    const pending = initialSelectionRef.current
    if (pending !== null && pending !== undefined) {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        applySelectionOffsets(view, getMarkdown()(ctx), pending.anchor, pending.head)
        view.focus()
      })
    }
    selectionAppliedRef.current = true
    onSelectionAppliedRef.current?.()
  }, [get, loading])

  useEffect(() => {
    const handle: EditorHandle = {
      getMarkdown: () => {
        const editor = get()
        return editor ? editor.action(getMarkdown()) : initialMarkdownRef.current
      },
      flushNow: () => sync.flushNow(),
      getSelectionOffsets: () => {
        const editor = get()
        if (!editor) return null
        return editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const markdown = getMarkdown()(ctx)
          return selectionOffsetsFromView(markdown, view)
        })
      },
      setSelectionOffsets: (anchor, head) => {
        const editor = get()
        if (!editor) return
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          applySelectionOffsets(view, getMarkdown()(ctx), anchor, head)
        })
      },
      focus: () => {
        const editor = get()
        if (!editor) return
        editor.action((ctx) => {
          ;(ctx.get(editorViewCtx) as unknown as { focus(): void } | undefined)?.focus()
        })
      },
      getScrollRatio: () => {
        const editor = get()
        if (!editor) return 0
        return editor.action((ctx) => {
          // @milkdown 的 editorViewCtx 泛型未暴露 scrollDOM，运行时是标准 ProseMirror EditorView
          const dom = (ctx.get(editorViewCtx) as unknown as { scrollDOM: HTMLElement } | undefined)
            ?.scrollDOM
          if (dom === undefined) return 0
          return dom.scrollHeight === 0 ? 0 : dom.scrollTop / dom.scrollHeight
        })
      },
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
