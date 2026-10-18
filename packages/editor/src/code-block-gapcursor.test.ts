// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { getMarkdown } from '@milkdown/kit/utils'
import { GapCursor } from '@milkdown/prose/gapcursor'
import type { EditorView as PMEditorView } from '@milkdown/prose/view'
import { describe, expect, it } from 'vitest'
import { codeBlockView } from './code-block-view'
import { createImageView } from './image-view'

let container: HTMLDivElement

async function createEditor(markdown: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container)
      ctx.set(defaultValueCtx, markdown)
    })
    .use(commonmark)
    .use(codeBlockView)
  await editor.create()
  const pmView = editor.action((ctx) => ctx.get(editorViewCtx)) as PMEditorView
  return {
    pmView,
    getMarkdown: () => editor.action(getMarkdown()),
    destroy: async () => {
      await editor.destroy()
      container.remove()
    },
  }
}

function getCmView(): EditorView {
  const cmDom = container.querySelector('.cm-editor')
  if (!cmDom) throw new Error('CM root not mounted')
  const view = EditorView.findFromDOM(cmDom as HTMLElement)
  if (!view) throw new Error('EditorView not found')
  return view
}

function pressKey(key: string): void {
  const dom = container.querySelector('.cm-content')
  if (!dom) throw new Error('cm-content missing')
  dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

describe('code block gap cursor exit', () => {
  it('ArrowDown at block end with no next text block falls to gap cursor below the block', async () => {
    const { pmView, destroy } = await createEditor('```ts\ncode\n```\n')
    const cm = getCmView()
    cm.dispatch({ selection: { anchor: 4 } })
    pressKey('ArrowDown')
    expect(pmView.state.selection).toBeInstanceOf(GapCursor)
    expect(pmView.state.selection.anchor).toBe(pmView.state.doc.content.size)
    // gap cursor 处续写：插入段落（真实键入走 DOM 变更解析，由 e2e 覆盖）
    const paragraph = pmView.state.schema.nodes.paragraph.createAndFill(
      null,
      pmView.state.schema.text('after'),
    )
    pmView.dispatch(pmView.state.tr.replaceSelectionWith(paragraph!))
    expect(pmView.state.doc.childCount).toBe(2)
    expect(pmView.state.doc.firstChild!.textContent).toBe('code')
    expect(pmView.state.doc.lastChild!.textContent).toBe('after')
    await destroy()
  })

  it('gap cursor before the first block works for ArrowUp exit', async () => {
    const { pmView, destroy } = await createEditor('```ts\ncode\n```\n\nafter\n')
    const cm = getCmView()
    cm.dispatch({ selection: { anchor: 0 } })
    pressKey('ArrowUp')
    expect(pmView.state.selection).toBeInstanceOf(GapCursor)
    expect(pmView.state.selection.anchor).toBe(0)
    await destroy()
  })
})

describe('image node view display resolution', () => {
  it('resolves relative src for display only; serialization keeps the original path (R1)', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, container)
        ctx.set(defaultValueCtx, '![alt text](assets/pic.png)\n')
      })
      .use(commonmark)
      .use(
        createImageView((src) => (src === 'assets/pic.png' ? 'data:image/png;base64,AAA=' : null)),
      )
    await editor.create()
    const img = container.querySelector(
      '.ProseMirror img:not(.ProseMirror-separator)',
    ) as HTMLImageElement | null
    expect(img).not.toBeNull()
    // 解析可能是异步的：等 NodeView 把显示 src 换成 data URI
    await expect
      .poll(() => img!.getAttribute('src'), { timeout: 2_000 })
      .toBe('data:image/png;base64,AAA=')
    expect(editor.action(getMarkdown())).toBe('![alt text](assets/pic.png)\n')
    await editor.destroy()
    container.remove()
  })

  it('keeps data uri and remote src untouched; null resolution falls back to original src', async () => {
    const md =
      '![](data:image/png;base64,AAA=)\n\n![](https://example.com/a.png)\n\n![](assets/missing.png)\n'
    container = document.createElement('div')
    document.body.appendChild(container)
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, container)
        ctx.set(defaultValueCtx, md)
      })
      .use(commonmark)
      .use(createImageView(() => null))
    await editor.create()
    const imgs = Array.from(
      container.querySelectorAll('.ProseMirror img:not(.ProseMirror-separator)'),
    ) as HTMLImageElement[]
    expect(imgs).toHaveLength(3)
    expect(imgs[0]!.getAttribute('src')).toBe('data:image/png;base64,AAA=')
    expect(imgs[1]!.getAttribute('src')).toBe('https://example.com/a.png')
    expect(imgs[2]!.getAttribute('src')).toBe('assets/missing.png')
    // 原始 src 必须同步渲染（解析失败时也保持可见路径）
    expect(editor.action(getMarkdown())).toBe(md)
    await editor.destroy()
    container.remove()
  })
})
