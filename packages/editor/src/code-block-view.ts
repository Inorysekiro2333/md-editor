import { EditorView as CMView, keymap, ViewUpdate } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { nodeViewCtx, SchemaReady } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/prose/state'
import type { Node as PMNode } from '@milkdown/prose/model'
import type { EditorView as PMView, NodeView, NodeViewConstructor } from '@milkdown/prose/view'

const COPY_RESET_MS = 1500
const COPY_LABEL = '复制'
const COPIED_LABEL = '已复制'

/**
 * Vanilla-TS CodeMirror 6 NodeView for Milkdown's commonmark code_block schema
 * (Ruling-1: the official @milkdown code-block component is a Vue app and is
 * forbidden here). CM owns the visible code text; every CM change is written
 * back into the PM node so the Markdown buffer stays the single source of truth.
 */
export class CodeBlockNodeView implements NodeView {
  dom: HTMLElement
  private node: PMNode
  private readonly outerView: PMView
  private readonly getPos: () => number | undefined
  private readonly select: HTMLSelectElement
  private readonly copyButton: HTMLButtonElement
  private cmView: CMView
  private readonly languageCompartment = new Compartment()
  private updating = false
  private languageToken: symbol | null = null
  private copyTimer: ReturnType<typeof setTimeout> | null = null

  constructor(node: PMNode, view: PMView, getPos: () => number | undefined) {
    this.node = node
    this.outerView = view
    this.getPos = getPos

    this.dom = document.createElement('div')
    this.dom.classList.add('md-codeblock')

    const header = document.createElement('div')
    header.classList.add('md-codeblock-header')

    this.select = document.createElement('select')
    this.select.classList.add('md-codeblock-lang')
    this.select.setAttribute('aria-label', '代码块语言')
    const plainOption = document.createElement('option')
    plainOption.value = ''
    plainOption.textContent = 'plain text'
    this.select.appendChild(plainOption)
    for (const desc of languages) {
      const option = document.createElement('option')
      option.value = desc.name.toLowerCase()
      option.textContent = desc.name
      this.select.appendChild(option)
    }
    const initialLanguage = typeof node.attrs.language === 'string' ? node.attrs.language : ''
    // Preserve user-written fence languages that are not in the preset list
    // (e.g. `ts`, `pseudocode`) so the select never silently rewrites them.
    if (
      initialLanguage &&
      !Array.from(this.select.options).some((o) => o.value === initialLanguage)
    ) {
      const custom = document.createElement('option')
      custom.value = initialLanguage
      custom.textContent = initialLanguage
      this.select.appendChild(custom)
    }
    this.select.value = initialLanguage
    this.select.addEventListener('change', () => this.setLanguage(this.select.value))

    this.copyButton = document.createElement('button')
    this.copyButton.type = 'button'
    this.copyButton.classList.add('md-codeblock-copy')
    this.copyButton.textContent = COPY_LABEL
    this.copyButton.setAttribute('aria-label', '复制代码')
    this.copyButton.addEventListener('click', () => this.copy())

    header.appendChild(this.select)
    header.appendChild(this.copyButton)
    this.dom.appendChild(header)

    const body = document.createElement('div')
    body.classList.add('md-codeblock-body')
    this.dom.appendChild(body)

    this.loadLanguage(this.select.value)
    this.cmView = new CMView({
      state: EditorState.create({
        doc: node.textContent,
        extensions: [
          this.languageCompartment.of([]),
          keymap.of([
            { key: 'ArrowUp', run: () => this.maybeEscape(-1, 'start') },
            { key: 'ArrowDown', run: () => this.maybeEscape(1, 'end') },
            { key: 'Escape', run: () => this.maybeEscape(-1, 'any') },
          ]),
          CMView.updateListener.of((update) => this.onCmChange(update)),
        ],
      }),
      parent: body,
    })
  }

  update(node: PMNode): boolean {
    if (node.type.name !== this.node.type.name) return false
    this.node = node
    const text = node.textContent
    if (!this.updating && this.cmView.state.doc.toString() !== text) {
      this.updating = true
      this.cmView.dispatch({ changes: { from: 0, to: this.cmView.state.doc.length, insert: text } })
      this.updating = false
    }
    const language = typeof node.attrs.language === 'string' ? node.attrs.language : ''
    if (this.select.value !== language) this.setLanguage(language)
    return true
  }

  ignoreMutation(): boolean {
    // All mutations happen inside CM; PM must not treat them as doc edits.
    return true
  }

  stopEvent(): boolean {
    // CM handles every event inside the block (including copy/paste keys).
    return true
  }

  destroy(): void {
    if (this.copyTimer !== null) clearTimeout(this.copyTimer)
    this.cmView.destroy()
  }

  private copy(): void {
    navigator.clipboard
      .writeText(this.node.textContent)
      .then(() => {
        this.copyButton.textContent = COPIED_LABEL
        if (this.copyTimer !== null) clearTimeout(this.copyTimer)
        this.copyTimer = setTimeout(() => {
          this.copyButton.textContent = COPY_LABEL
          this.copyTimer = null
        }, COPY_RESET_MS)
      })
      .catch(() => {
        // Clipboard rejection (permissions/unsupported): keep button label as-is.
      })
  }

  private setLanguage(language: string): void {
    this.select.value = language
    const pos = this.getPos()
    if (pos !== undefined && this.node.attrs.language !== language) {
      this.outerView.dispatch(
        this.outerView.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          language,
        }),
      )
    }
    this.loadLanguage(language)
  }

  /** Lazy-load highlight support; the compartment stays empty until ready. */
  private loadLanguage(language: string): void {
    const token = Symbol()
    this.languageToken = token
    if (!language) return
    const desc = LanguageDescription.matchLanguageName(languages, language, true)
    if (!desc) return
    void desc.load().then((support) => {
      if (this.languageToken !== token) return
      this.cmView.dispatch({
        effects: this.languageCompartment.reconfigure(support),
      })
    })
  }

  /**
   * Clean-room maybeEscape semantics (modeled on Milkdown's behavior, not its
   * code): the cursor leaves the block through PM when the user presses Escape
   * or an arrow key at the block's first/last boundary.
   */
  private maybeEscape(dir: -1 | 1, edge: 'start' | 'end' | 'any'): boolean {
    const { state } = this.cmView
    const { from, to, empty } = state.selection.ranges[0]
    if (!empty && edge === 'any') return false
    if (edge === 'start' && from > 0) return false
    if (edge === 'end' && to < state.doc.length) return false
    const pos = this.getPos()
    if (pos === undefined) return false
    // Escape direction: selection at start exits up, otherwise exits down.
    const exitDir: -1 | 1 = edge === 'any' ? (from === 0 ? -1 : 1) : dir
    const boundary = exitDir < 0 ? pos : pos + this.node.nodeSize
    const target = TextSelection.near(this.outerView.state.doc.resolve(boundary), exitDir)
    this.outerView.dispatch(this.outerView.state.tr.setSelection(target))
    this.outerView.focus()
    return true
  }

  private onCmChange(update: ViewUpdate): void {
    if (!update.docChanged || this.updating) return
    const pos = this.getPos()
    if (pos === undefined) return
    const text = update.state.doc.toString()
    const range = { from: pos + 1, to: pos + 1 + this.node.content.size }
    this.updating = true
    try {
      this.outerView.dispatch(this.outerView.state.tr.insertText(text, range.from, range.to))
    } finally {
      this.updating = false
    }
  }
}

/**
 * Register the CodeBlockNodeView for Milkdown's commonmark code_block schema.
 * (Hand-rolled instead of $view: @milkdown/utils 7.22.3's $view reads
 * `type.id` before the schema plugin assigns it, registering under `undefined`
 * so the node view never mounts.)
 */
export const codeBlockView: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SchemaReady)
  // commonmark registers the code_block node under this fixed id.
  const id = 'code_block'
  const constructor: NodeViewConstructor = (node, view, getPos) =>
    new CodeBlockNodeView(node, view, getPos)
  ctx.update(nodeViewCtx, (ps) => [...ps, [id, constructor] as [string, NodeViewConstructor]])
  return () => {
    ctx.update(nodeViewCtx, (ps) => ps.filter(([key]) => key !== id))
  }
}
