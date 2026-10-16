import { defaultValueCtx, Editor, rootCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { DOMParser as ProseDomParser, Fragment, Slice } from '@milkdown/prose/model'
import { Plugin, type Transaction } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'

export type OnPasteAsset = (base64: string, mime: string) => Promise<string>

export type PasteRule = {
  run: (slice: Slice, view: EditorView, isPlainText: boolean) => Slice
  priority?: number
}

const URL_PATTERN = /^https?:\/\/\S+$/i

// ---------------------------------------------------------------------------
// HTML -> Markdown：走 Milkdown 内部管线（同一 schema 的 DOMParser + serializer），
// 禁止引入 turndown 等第二套转换器。
// ---------------------------------------------------------------------------

type HtmlToMarkdownFn = (html: string) => string

let converterPromise: Promise<HtmlToMarkdownFn> | null = null

async function initHtmlToMarkdown(): Promise<HtmlToMarkdownFn> {
  // 离屏编辑器仅用于获取 schema 与 serializer，不挂载到可见 DOM。
  const root = document.createElement('div')
  root.style.display = 'none'
  document.body.appendChild(root)
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, '')
    })
    .use(commonmark)
    .use(gfm)
    .create()
  return (html: string): string => {
    const dom = new DOMParser().parseFromString(html, 'text/html')
    const schema = editor.action((ctx) => ctx.get(schemaCtx))
    const doc = ProseDomParser.fromSchema(schema).parse(dom.body)
    return editor.action((ctx) => ctx.get(serializerCtx)(doc))
  }
}

export function getHtmlToMarkdown(): Promise<HtmlToMarkdownFn> {
  converterPromise ??= initHtmlToMarkdown()
  return converterPromise
}

// ---------------------------------------------------------------------------
// 粘贴能力（Milkdown 首选扩展点）：
// - pasteRulesCtx PasteRule：纯文本 URL + 有选中文本 -> [文字](url)
//   （Milkdown 在 EditorView props 层接管 transformPasted，插件 props 无法生效，
//    必须走 pasteRulesCtx）
// - prosePluginsCtx Plugin.handlePaste：剪贴板带图片文件 ->
//   onPasteAsset(base64, mime) -> 插入 ![](相对路径)
// - text/html 由 ProseMirror 默认 DOMParser（同一 schema）处理，无需干预
// ---------------------------------------------------------------------------

export function createPasteRule(): PasteRule {
  return {
    run(slice: Slice, view: EditorView): Slice {
      const state = view.state
      const { from, to, empty } = state.selection
      if (empty || slice.content.childCount !== 1) return slice
      const node = slice.content.firstChild
      if (!node?.isText || typeof node.text !== 'string' || !URL_PATTERN.test(node.text)) {
        return slice
      }
      const { schema } = state
      if (!schema.marks.link) return slice
      const selectedText = state.doc.textBetween(from, to, ' ')
      if (!selectedText) return slice
      const linkNode = schema.text(selectedText, [schema.marks.link.create({ href: node.text })])
      return new Slice(Fragment.from(linkNode), 0, 0)
    },
  }
}

export function createPastePlugin(getOnPasteAsset: () => OnPasteAsset | undefined): Plugin {
  return new Plugin({
    props: {
      handlePaste(view: EditorView, event: ClipboardEvent): boolean {
        const clipboard = event.clipboardData
        if (!clipboard) return false
        const file = Array.from(clipboard.files).find((f) => f.type.startsWith('image/'))
        if (!file) return false
        const onPasteAsset = getOnPasteAsset()
        if (!onPasteAsset) return false
        event.preventDefault()
        void (async () => {
          try {
            const base64 = await fileToBase64(file)
            const relativePath = await onPasteAsset(base64, file.type)
            const imageNode = view.state.schema.nodes.image?.create({
              src: relativePath,
              alt: '',
            })
            let tr: Transaction
            if (imageNode) {
              tr = view.state.tr.replaceSelectionWith(imageNode)
            } else {
              tr = view.state.tr.insertText(`![](${relativePath})`)
            }
            tr.scrollIntoView()
            view.dispatch(tr)
          } catch (error) {
            console.error('[editor] image paste failed', error)
          }
        })()
        return true
      },
    },
  })
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('unexpected FileReader result'))
        return
      }
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}
