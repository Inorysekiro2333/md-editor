// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AboutDialog } from './AboutDialog'

describe('AboutDialog', () => {
  let container: HTMLDivElement
  let root: Root | null = null

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

  it('renders app name, version, electron and chromium', () => {
    act(() => {
      root = createRoot(container)
      root.render(
        <AboutDialog version="0.1.0" electron="44.7.2" chromium="138.0.0.0" onClose={() => {}} />,
      )
    })
    expect(container.querySelector('[aria-label="关于 md-editor"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="about-version"]')?.textContent).toBe('0.1.0')
    expect(container.querySelector('[data-testid="about-electron"]')?.textContent).toBe('44.7.2')
    expect(container.querySelector('[data-testid="about-chromium"]')?.textContent).toBe('138.0.0.0')
  })

  it('close button invokes onClose', () => {
    const onClose = vi.fn()
    act(() => {
      root = createRoot(container)
      root.render(<AboutDialog version="0.1.0" electron="1" chromium="2" onClose={onClose} />)
    })
    const button = container.querySelector<HTMLButtonElement>('[data-testid="about-close"]')
    expect(button).not.toBeNull()
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
