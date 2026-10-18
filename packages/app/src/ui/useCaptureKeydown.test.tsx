// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useCaptureKeydown } from './useCaptureKeydown'

function Probe({ onKeyDown }: { onKeyDown: (event: KeyboardEvent) => void }): null {
  useCaptureKeydown(onKeyDown)
  return null
}

describe('useCaptureKeydown', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = null
    container.remove()
  })

  it('StrictMode double-mount leaves exactly one keydown listener', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const calls: string[] = []
    root = createRoot(container)
    act(() => {
      root?.render(
        <StrictMode>
          <Probe onKeyDown={(event) => calls.push(event.key)} />
        </StrictMode>,
      )
    })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    })
    // 泄漏回归：监听器 add(true)/remove() capture 标志不匹配时，
    // StrictMode 双挂载会残留第一个监听器，这里会得到 2 次调用。
    expect(calls).toEqual(['s'])
  })

  it('keeps dispatching through the latest handler after re-render', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const calls: string[] = []
    root = createRoot(container)
    act(() => {
      root?.render(
        <StrictMode>
          <Probe onKeyDown={(e) => calls.push('first:' + e.key)} />
        </StrictMode>,
      )
    })
    act(() => {
      root?.render(
        <StrictMode>
          <Probe onKeyDown={(e) => calls.push('second:' + e.key)} />
        </StrictMode>,
      )
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    })
    expect(calls).toEqual(['second:s'])
  })
})
