// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { runSourceFormatCommand } from './source-format-commands'

function createView(doc: string) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const view = new EditorView({ state: EditorState.create({ doc }), parent: host })
  return { view, cleanup: () => host.remove() }
}

describe('runSourceFormatCommand', () => {
  it('wraps selection with bold markers', () => {
    const { view, cleanup } = createView('hello world')
    view.dispatch({ selection: EditorSelection.range(0, 5) })
    expect(runSourceFormatCommand(view, 'bold')).toBe(true)
    expect(view.state.doc.toString()).toBe('**hello** world')
    cleanup()
  })

  it('strips existing bold markers before wrapping a partial selection', () => {
    const { view, cleanup } = createView('x **y** z')
    view.dispatch({ selection: EditorSelection.range(2, 9) })
    expect(runSourceFormatCommand(view, 'bold')).toBe(true)
    expect(view.state.doc.toString()).toBe('x **y z**')
    cleanup()
  })

  it('strips existing italic markers before wrapping a partial selection', () => {
    const { view, cleanup } = createView('x *y* z')
    view.dispatch({ selection: EditorSelection.range(2, 7) })
    expect(runSourceFormatCommand(view, 'italic')).toBe(true)
    expect(view.state.doc.toString()).toBe('x *y z*')
    cleanup()
  })

  it('converts an empty line to a heading without trailing space (R1)', () => {
    const { view, cleanup } = createView('a\n\nb')
    const emptyLine = view.state.doc.line(2)
    view.dispatch({ selection: EditorSelection.cursor(emptyLine.from) })
    expect(runSourceFormatCommand(view, 'h1')).toBe(true)
    expect(view.state.doc.toString()).toBe('a\n#\nb')
    cleanup()
  })

  it('converts a non-empty line to a heading keeping body text', () => {
    const { view, cleanup } = createView('title')
    expect(runSourceFormatCommand(view, 'h3')).toBe(true)
    expect(view.state.doc.toString()).toBe('### title')
    cleanup()
  })

  it('toggles blockquote prefix on current line', () => {
    const { view, cleanup } = createView('hello')
    expect(runSourceFormatCommand(view, 'blockquote')).toBe(true)
    expect(view.state.doc.toString()).toBe('> hello')
    expect(runSourceFormatCommand(view, 'blockquote')).toBe(true)
    expect(view.state.doc.toString()).toBe('hello')
    cleanup()
  })

  it('inserts a markdown table with empty header cells at cursor', () => {
    const { view, cleanup } = createView('x')
    view.dispatch({ selection: EditorSelection.cursor(1) })
    expect(runSourceFormatCommand(view, 'insertTable')).toBe(true)
    expect(view.state.doc.toString()).toBe(
      'x|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |',
    )
    cleanup()
  })

  it('falls back to 3x3 when table args are NaN or Infinity', () => {
    const { view, cleanup } = createView('x')
    view.dispatch({ selection: EditorSelection.cursor(1) })
    expect(
      runSourceFormatCommand(view, 'insertTable', {
        rows: Number.NaN,
        cols: Number.POSITIVE_INFINITY,
      }),
    ).toBe(true)
    expect(view.state.doc.toString()).toBe(
      'x|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |',
    )
    cleanup()
  })
})
