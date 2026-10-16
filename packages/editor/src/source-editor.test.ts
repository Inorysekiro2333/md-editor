// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { SourceEditor, type SourceEditorHandle } from './source-editor'

let container: HTMLDivElement
let root: Root
let handle: SourceEditorHandle | null
let onMarkdownChange: Mock<(markdown: string) => void>

function renderSourceEditor(initialMarkdown: string, initialScrollRatio?: number): void {
  act(() => {
    root.render(
      createElement(SourceEditor, {
        initialMarkdown,
        onMarkdownChange,
        onReady: (h) => {
          handle = h
        },
        initialScrollRatio,
      }),
    )
  })
}

function getView(): EditorView {
  const editorDom = container.querySelector('.cm-editor')
  if (!editorDom) throw new Error('CodeMirror root not mounted')
  const view = EditorView.findFromDOM(editorDom as HTMLElement)
  if (!view) throw new Error('EditorView not found')
  return view
}

/** 通过视图事务模拟输入；组件监听的是 updateListener.docChanged，与真实键入一致。 */
function typeText(text: string, from: number): void {
  const view = getView()
  act(() => {
    view.dispatch({ changes: { from, insert: text } })
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  handle = null
  onMarkdownChange = vi.fn<(markdown: string) => void>()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('SourceEditor', () => {
  it('getText returns initialMarkdown on mount', () => {
    renderSourceEditor('# hello\n\nworld')
    expect(handle).not.toBeNull()
    expect(handle?.getText()).toBe('# hello\n\nworld')
  })

  it('schedules onMarkdownChange after 300ms debounce', () => {
    renderSourceEditor('# hello')
    typeText('x', 7)
    expect(onMarkdownChange).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onMarkdownChange).toHaveBeenCalledTimes(1)
    expect(onMarkdownChange).toHaveBeenCalledWith('# hellox')
  })

  it('setSelectionOffsets round-trips through getSelectionOffsets', () => {
    renderSourceEditor('# title\n\nbody')
    act(() => {
      handle?.setSelectionOffsets(2, 5)
    })
    expect(handle?.getSelectionOffsets()).toEqual({ anchor: 2, head: 5 })
  })

  it('flushNow converges immediately without waiting for debounce', () => {
    renderSourceEditor('abc')
    typeText('d', 3)
    handle?.flushNow()
    expect(onMarkdownChange).toHaveBeenCalledTimes(1)
    expect(onMarkdownChange).toHaveBeenCalledWith('abcd')
  })

  it('getScrollRatio returns 0 when scrollHeight is 0', () => {
    renderSourceEditor('abc')
    expect(handle?.getScrollRatio()).toBe(0)
  })

  it('getScrollRatio computes scrollTop / scrollHeight', () => {
    renderSourceEditor('abc')
    const scrollDOM = getView().scrollDOM
    Object.defineProperty(scrollDOM, 'scrollTop', { value: 50, configurable: true })
    Object.defineProperty(scrollDOM, 'scrollHeight', { value: 200, configurable: true })
    expect(handle?.getScrollRatio()).toBeCloseTo(0.25)
  })
})
