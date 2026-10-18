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

  it('toggles blockquote prefix on current line', () => {
    const { view, cleanup } = createView('hello')
    expect(runSourceFormatCommand(view, 'blockquote')).toBe(true)
    expect(view.state.doc.toString()).toBe('> hello')
    expect(runSourceFormatCommand(view, 'blockquote')).toBe(true)
    expect(view.state.doc.toString()).toBe('hello')
    cleanup()
  })

  it('inserts a markdown table at cursor', () => {
    const { view, cleanup } = createView('x')
    expect(runSourceFormatCommand(view, 'insertTable')).toBe(true)
    expect(view.state.doc.toString()).toContain('| --- | --- | --- |')
    cleanup()
  })
})
