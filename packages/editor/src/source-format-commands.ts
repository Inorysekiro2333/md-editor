import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { FormatCommandName } from './format-commands'

/**
 * 源码模式的格式化命令：直接编辑 Markdown Buffer 文本（CM 事务经 sync 收敛）。
 * 与 WYSIWYG 侧 runFormatCommand 同名命令、语义对齐。
 */
export function runSourceFormatCommand(view: EditorView, name: FormatCommandName): boolean {
  const { state } = view
  const sel = state.selection.main
  const text = (from: number, to: number): string => state.sliceDoc(from, to)

  const wrap = (marker: string): boolean => {
    const selected = text(sel.from, sel.to)
    const has =
      selected.startsWith(marker) &&
      selected.endsWith(marker) &&
      selected.length >= marker.length * 2
    const inner = has
      ? selected.slice(marker.length, selected.length - marker.length)
      : `${marker}${selected}${marker}`
    view.dispatch(
      state.update({
        changes: { from: sel.from, to: sel.to, insert: inner },
        selection: EditorSelection.range(
          sel.from + (has ? 0 : marker.length),
          sel.from + inner.length - (has ? 0 : marker.length),
        ),
      }),
    )
    view.focus()
    return true
  }

  const transformLines = (fn: (line: string) => string): boolean => {
    const fromLine = state.doc.lineAt(sel.from)
    const toLine = state.doc.lineAt(sel.to)
    const changes: Array<{ from: number; to: number; insert: string }> = []
    for (let no = fromLine.number; no <= toLine.number; no += 1) {
      const line = state.doc.line(no)
      if (line.text.length === 0 && toLine.number > fromLine.number) continue
      changes.push({ from: line.from, to: line.to, insert: fn(line.text) })
    }
    view.dispatch(state.update({ changes }))
    view.focus()
    return true
  }

  const togglePrefix = (pattern: RegExp, prefix: string): boolean =>
    transformLines((line) => (pattern.test(line) ? line.replace(pattern, '') : prefix + line))

  switch (name) {
    case 'bold':
      return wrap('**')
    case 'italic':
      return wrap('*')
    case 'strikethrough':
      return wrap('~~')
    case 'inlineCode':
      return wrap('`')
    case 'h1':
      return transformLines((line) => line.replace(/^#{1,6}\s+/, '').replace(/^(.*)$/, `# $1`))
    case 'h2':
      return transformLines((line) => line.replace(/^#{1,6}\s+/, '').replace(/^(.*)$/, `## $1`))
    case 'h3':
      return transformLines((line) => line.replace(/^#{1,6}\s+/, '').replace(/^(.*)$/, `### $1`))
    case 'orderedList':
      return togglePrefix(/^\s*\d+\.\s+/, '1. ')
    case 'bulletList':
      return togglePrefix(/^\s*[-*+]\s+/, '- ')
    case 'blockquote':
      return togglePrefix(/^\s*>\s+/, '> ')
    case 'insertTable': {
      const table = ['| 列1 | 列2 | 列3 |', '| --- | --- | --- |', '|  |  |  |', '|  |  |  |'].join(
        '\n',
      )
      const insert = sel.empty ? table : `\n${table}\n`
      view.dispatch(
        state.update({
          changes: { from: sel.from, to: sel.to, insert },
          selection: EditorSelection.cursor(sel.from + insert.length),
        }),
      )
      view.focus()
      return true
    }
    default:
      return false
  }
}
