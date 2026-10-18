// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormatCommandName } from '@md-editor/editor'
import { FormatToolbar } from './FormatToolbar'

describe('FormatToolbar', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  const render = (onCommand: (name: FormatCommandName) => void, disabled = false): void => {
    root = createRoot(container)
    act(() => {
      root?.render(<FormatToolbar disabled={disabled} onCommand={onCommand} />)
    })
  }

  const click = (element: Element): void => {
    act(() => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
  })

  it('dispatches bold/italic to the editor command entry', () => {
    const onCommand = vi.fn()
    render(onCommand)
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.format-toolbar-btn'))
    click(buttons[0]!)
    expect(onCommand).toHaveBeenCalledWith('bold')
    click(buttons[1]!)
    expect(onCommand).toHaveBeenCalledWith('italic')
  })

  it('shows shortcut in title and aria-label', () => {
    render(vi.fn())
    const bold = container.querySelector<HTMLButtonElement>('.format-toolbar-btn')!
    expect(bold.title).toBe('加粗 (Ctrl+B)')
    expect(bold.getAttribute('aria-label')).toBe('加粗 (Ctrl+B)')
  })

  it('dispatches heading level via dropdown', () => {
    const onCommand = vi.fn()
    render(onCommand)
    const select = container.querySelector<HTMLSelectElement>('[data-testid="heading-select"]')!
    act(() => {
      select.value = 'h2'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onCommand).toHaveBeenCalledWith('h2')
  })

  it('renders disabled state', () => {
    render(vi.fn(), true)
    const bold = container.querySelector<HTMLButtonElement>('.format-toolbar-btn')!
    expect(bold.disabled).toBe(true)
  })
})
