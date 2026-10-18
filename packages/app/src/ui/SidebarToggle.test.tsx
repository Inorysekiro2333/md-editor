// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarToggle } from './SidebarToggle'

describe('SidebarToggle', () => {
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

  function render(collapsed: boolean, onToggle: () => void): void {
    act(() => {
      root = createRoot(container)
      root.render(<SidebarToggle collapsed={collapsed} onToggle={onToggle} />)
    })
  }

  it('labels expanded state and toggles on click', () => {
    const onToggle = vi.fn()
    render(false, onToggle)
    const button = container.querySelector<HTMLButtonElement>('[data-testid="sidebar-toggle"]')
    expect(button?.getAttribute('aria-label')).toBe('收起侧栏')
    expect(button?.getAttribute('aria-pressed')).toBe('false')
    act(() => {
      button?.click()
    })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('labels collapsed state', () => {
    render(true, () => {})
    const button = container.querySelector<HTMLButtonElement>('[data-testid="sidebar-toggle"]')
    expect(button?.getAttribute('aria-label')).toBe('展开侧栏')
    expect(button?.getAttribute('aria-pressed')).toBe('true')
  })
})
