import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownSync } from './sync'

describe('createMarkdownSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes once after the debounce window', () => {
    const onFlush = vi.fn()
    const sync = createMarkdownSync({ delayMs: 300, serialize: () => '# md', onFlush })

    sync.schedule()
    sync.schedule()
    sync.schedule()
    vi.advanceTimersByTime(299)
    expect(onFlush).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith('# md')
    expect(sync.pending).toBe(false)
  })

  it('flushNow writes immediately and does not fire again later', () => {
    const onFlush = vi.fn()
    const sync = createMarkdownSync({ delayMs: 300, serialize: () => 'body', onFlush })

    sync.schedule()
    sync.flushNow()

    expect(onFlush).toHaveBeenCalledWith('body')
    vi.advanceTimersByTime(1000)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('does nothing when flushed without pending changes', () => {
    const onFlush = vi.fn()
    const sync = createMarkdownSync({ serialize: () => 'x', onFlush })

    sync.flushNow()
    vi.advanceTimersByTime(1000)

    expect(onFlush).not.toHaveBeenCalled()
  })

  it('dispose cancels a pending flush', () => {
    const onFlush = vi.fn()
    const sync = createMarkdownSync({ delayMs: 300, serialize: () => 'x', onFlush })

    sync.schedule()
    sync.dispose()
    vi.advanceTimersByTime(1000)

    expect(onFlush).not.toHaveBeenCalled()
    expect(sync.pending).toBe(false)
  })

  it('serializes at flush time, not at schedule time', () => {
    let markdown = 'first'
    const onFlush = vi.fn()
    const sync = createMarkdownSync({ delayMs: 300, serialize: () => markdown, onFlush })

    sync.schedule()
    markdown = 'second'
    vi.advanceTimersByTime(300)

    expect(onFlush).toHaveBeenCalledWith('second')
  })
})
