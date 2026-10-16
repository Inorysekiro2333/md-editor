import { defaultValueCtx, Editor, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { getMarkdown } from '@milkdown/kit/utils'

export interface TestEditor {
  getMarkdown(): string
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
    })
    .use(commonmark)
    .use(gfm)
  await editor.create()
  return {
    getMarkdown: () => editor.action(getMarkdown()),
    destroy: async () => {
      await editor.destroy()
      root.remove()
    },
  }
}
