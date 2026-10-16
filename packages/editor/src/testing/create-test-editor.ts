import { editorViewCtx, defaultValueCtx, Editor, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { getMarkdown } from '@milkdown/kit/utils'
import { prosePluginsCtx } from '@milkdown/kit/core'
import { sessionRecorderPlugin } from '../session-history'
import type { EditorView } from '@milkdown/prose/view'

export interface TestEditor {
  getMarkdown(): string
  getView(): EditorView
  action<T>(fn: (ctx: Parameters<Parameters<Editor['action']>[0]>[0]) => T): T
  destroy(): Promise<void>
}

/** Create a React-free Milkdown Editor under jsdom for round-trip tests. */
export async function createTestEditor(markdown: string): Promise<TestEditor> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, markdown)
      ctx.update(prosePluginsCtx, (ps) => [...ps, sessionRecorderPlugin])
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
  await editor.create()
  return {
    getMarkdown: () => editor.action(getMarkdown()),
    getView: () => editor.action((ctx) => ctx.get(editorViewCtx)),
    action: (fn) => editor.action(fn),
    destroy: async () => {
      await editor.destroy()
      root.remove()
    },
  }
}
