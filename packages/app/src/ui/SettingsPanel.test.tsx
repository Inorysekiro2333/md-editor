// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemeId } from '@md-editor/theming'
import { SettingsPanel } from './SettingsPanel'

describe('SettingsPanel', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  const render = (props: {
    theme: ThemeId
    printBackground: boolean
    onChangeTheme: (theme: ThemeId) => void
    onChangePrintBackground: (printBackground: boolean) => void
    onClose: () => void
  }): void => {
    root = createRoot(container)
    act(() => {
      root?.render(
        <SettingsPanel
          initialTheme={props.theme}
          printBackground={props.printBackground}
          onChangeTheme={props.onChangeTheme}
          onChangePrintBackground={props.onChangePrintBackground}
          onClose={props.onClose}
        />,
      )
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
    act(() => {
      root?.unmount()
    })
    container.remove()
    root = null
  })

  it('renders three theme radios and switches theme on selection', () => {
    const onChangeTheme = vi.fn()
    const onClose = vi.fn()
    render({
      theme: 'github-light',
      printBackground: true,
      onChangeTheme,
      onChangePrintBackground: vi.fn(),
      onClose,
    })

    const dark = document.querySelector<HTMLInputElement>('input[data-testid="theme-github-dark"]')
    expect(dark).not.toBeNull()
    expect(document.querySelector('input[data-testid="theme-github-light"]')).not.toBeNull()
    expect(document.querySelector('input[data-testid="theme-paper-serif"]')).not.toBeNull()
    expect(dark!.checked).toBe(false)

    click(dark!)
    expect(onChangeTheme).toHaveBeenCalledWith('github-dark')

    click(document.querySelector<HTMLButtonElement>('button[data-testid="settings-close"]')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('toggles pdf printBackground and reports the new value', () => {
    const onChangePrintBackground = vi.fn()
    render({
      theme: 'paper-serif',
      printBackground: false,
      onChangeTheme: vi.fn(),
      onChangePrintBackground,
      onClose: vi.fn(),
    })
    const toggle = document.querySelector<HTMLInputElement>(
      'input[data-testid="pdf-print-background"]',
    )
    expect(toggle?.disabled).toBe(false)
    expect(toggle?.checked).toBe(false)

    act(() => {
      toggle!.click()
    })
    expect(onChangePrintBackground).toHaveBeenCalledWith(true)
  })
})
