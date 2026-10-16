// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Fragment, Slice } from '@milkdown/prose/model'
import { TextSelection } from '@milkdown/prose/state'
import { createPastePlugin, createPasteRule, getHtmlToMarkdown } from './paste'
import { createTestEditor } from './testing/create-test-editor'

describe('htmlToMarkdown', () => {
  it('converts pasted HTML through the Milkdown schema pipeline', async () => {
    const htmlToMarkdown = await getHtmlToMarkdown()
    const markdown = htmlToMarkdown(
      '<h1>标题</h1><p><strong>加粗</strong> 与 <a href="https://e.com">链接</a></p><ul><li>项</li></ul>',
    )
    // Registered normalization: Milkdown 序列化统一使用 "*" 作为 bullet 标记
    expect(markdown).toBe('# 标题\n\n**加粗** 与 [链接](https://e.com)\n\n* 项\n')
  })
})

describe('URL paste becomes link over selection', () => {
  it('wraps the selected text with the pasted URL via transformPasted', async () => {
    const rule = createPasteRule()
    const editor = await createTestEditor('selected')
    try {
      const view = editor.getView()
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 9)))
      const schema = view.state.schema
      const slice = new Slice(Fragment.from(schema.text('https://example.com/a')), 0, 0)
      const transformed = rule.run(slice, view, true)
      expect(transformed).toBeDefined()
      view.dispatch(view.state.tr.replaceSelection(transformed!))
      expect(editor.getMarkdown()).toBe('[selected](https://example.com/a)\n')
    } finally {
      await editor.destroy()
    }
  })

  it('leaves non-URL slices untouched', async () => {
    const rule = createPasteRule()
    const editor = await createTestEditor('selected')
    try {
      const view = editor.getView()
      const schema = view.state.schema
      const slice = new Slice(Fragment.from(schema.text('plain text')), 0, 0)
      const transformed = rule.run(slice, view, true)
      expect(transformed).toBe(slice)
    } finally {
      await editor.destroy()
    }
  })
})

describe('image paste', () => {
  it('calls the asset callback and inserts an image node', async () => {
    const plugin = createPastePlugin(() => async () => 'assets/pic.png')
    const editor = await createTestEditor('body', [plugin])
    try {
      const view = editor.getView()
      // Plugin instance is registered like a prosemirror plugin; invoke its props directly.
      const props = plugin.props as {
        handlePaste?: (view: unknown, event: ClipboardEvent) => boolean
      }
      const bytes = new Uint8Array([1, 2, 3])
      const file = new File([bytes], 'pic.png', { type: 'image/png' })
      const event = new Event('paste') as ClipboardEvent
      Object.defineProperty(event, 'clipboardData', {
        value: { files: [file] },
      })
      expect(props.handlePaste).toBeDefined()
      const handled = props.handlePaste!(view, event)
      expect(handled).toBe(true)
      for (let i = 0; i < 50; i++) {
        if (editor.getMarkdown().includes('![](assets/pic.png)')) break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(editor.getMarkdown()).toContain('![](assets/pic.png)')
    } finally {
      await editor.destroy()
    }
  })

  it('ignores image paste when no asset callback is provided', async () => {
    const plugin = createPastePlugin(() => undefined)
    const editor = await createTestEditor('body', [plugin])
    try {
      const view = editor.getView()
      const props = plugin.props as {
        handlePaste?: (view: unknown, event: ClipboardEvent) => boolean
      }
      const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' })
      const event = new Event('paste') as ClipboardEvent
      Object.defineProperty(event, 'clipboardData', { value: { files: [file] } })
      expect(props.handlePaste!(view, event)).toBe(false)
    } finally {
      await editor.destroy()
    }
  })
})

describe('URL paste without selection', () => {
  it('inserts the URL as plain text when nothing is selected', async () => {
    const rule = createPasteRule()
    const editor = await createTestEditor('body')
    try {
      const view = editor.getView()
      const schema = view.state.schema
      const slice = new Slice(Fragment.from(schema.text('https://example.com/a')), 0, 0)
      // Registered behavior: 无选中文本时 URL 不变链接，按粘贴原文插入
      const transformed = rule.run(slice, view, true)
      expect(transformed).toBe(slice)
      view.dispatch(view.state.tr.replaceSelection(transformed!))
      expect(editor.getMarkdown()).toBe('https\\://example.com/abody' + '\n')
    } finally {
      await editor.destroy()
    }
  })
})
