// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { Editor, editorViewCtx, rootCtx, defaultValueCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { getMarkdown } from '@milkdown/kit/utils'
import type { Node as PMNode } from '@milkdown/prose/model'
import type { EditorView as PMEditorView } from '@milkdown/prose/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { codeBlockView } from './code-block-view'

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
    codeBlockNode: (): PMNode => {
      let found: PMNode | null = null
      pmView.state.doc.forEach((n) => {
        if (n.type.name === 'code_block') found = n
      })
      if (!found) throw new Error('code block not found')
      return found
    },
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('code block node view', () => {
  it('renders select + button + cm-editor with initial language', async () => {
    const { pmView, destroy } = await createEditor('```ts\nconst a = 1\n```\n')
    const select = container.querySelector<HTMLSelectElement>('.md-codeblock-lang')
    expect(select).not.toBeNull()
    expect(select?.value).toBe('ts')
    expect(container.querySelector('.md-codeblock-copy')).not.toBeNull()
    expect(container.querySelector('.cm-editor')).not.toBeNull()
    expect(getCmView().state.doc.toString()).toBe('const a = 1')
    expect(pmView.state.doc.textContent).toBe('const a = 1')
    await destroy()
  })

  it('changing language updates node.attrs.language and serialized fence', async () => {
    const { getMarkdown, codeBlockNode, destroy } = await createEditor('```ts\nconst a = 1\n```\n')
    const select = container.querySelector<HTMLSelectElement>('.md-codeblock-lang')
    select!.value = 'javascript'
    select!.dispatchEvent(new Event('change'))
    expect(codeBlockNode().attrs.language).toBe('javascript')
    expect(getMarkdown()).toBe('```javascript\nconst a = 1\n```\n')
    await destroy()
  })

  it('copy button writes node content to clipboard and shows 已复制 for 1.5s', async () => {
    const { codeBlockNode, destroy } = await createEditor('```ts\nconst a = 1\n```\n')
    const button = container.querySelector<HTMLButtonElement>('.md-codeblock-copy')
    button!.click()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('const a = 1')
    await vi.advanceTimersByTimeAsync(0)
    expect(button!.textContent).toBe('已复制')
    await vi.advanceTimersByTimeAsync(1500)
    expect(button!.textContent).toBe('复制')
    expect(codeBlockNode().textContent).toBe('const a = 1')
    await destroy()
  })

  it('CM input updates the PM doc and serialized markdown', async () => {
    const { pmView, getMarkdown, destroy } = await createEditor('```ts\nconst a = 1\n```\n')
    const cm = getCmView()
    cm.dispatch({ changes: { from: 11, insert: '\nconst b = 2' } })
    expect(pmView.state.doc.textContent).toBe('const a = 1\nconst b = 2')
    expect(getMarkdown()).toBe('```ts\nconst a = 1\nconst b = 2\n```\n')
    await destroy()
  })

  it('PM doc change syncs into CM (PM→CM one-way)', async () => {
    const { pmView, destroy } = await createEditor('```ts\nconst a = 1\n```\n')
    let pos = -1
    let node: PMNode | null = null
    pmView.state.doc.forEach((n, offset) => {
      if (n.type.name === 'code_block') {
        pos = offset
        node = n
      }
    })
    const tr = pmView.state.tr.insertText('console.log', pos + 1, pos + 1 + node!.content.size)
    pmView.dispatch(tr)
    expect(getCmView().state.doc.toString()).toBe('console.log')
    await destroy()
  })

  it('ArrowUp at start exits the code block via PM selection', async () => {
    const { pmView, destroy } = await createEditor('para\n\n```ts\ncode\n```\n')
    const cm = getCmView()
    cm.dispatch({ selection: { anchor: 0 } })
    cm.focus()
    cm.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    // PM selection must have moved before the code block (out of CM)
    const { state } = pmView
    expect(state.selection.from).toBeLessThan(state.doc.content.size - 5)
    expect(state.selection.to).toBeGreaterThanOrEqual(0)
    await destroy()
  })

  it('empty code block and embedded fences round-trip (registered via roundtrip.test.ts)', async () => {
    const { getMarkdown, destroy } = await createEditor('```js\n```\n')
    expect(getMarkdown()).toBe('```js\n```\n')
    await destroy()
  })
})
