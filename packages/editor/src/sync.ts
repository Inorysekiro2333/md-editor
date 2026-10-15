export interface MarkdownSyncOptions {
  /** 默认 300ms，与 architecture.md 3.2 的收敛窗口一致。 */
  delayMs?: number
  serialize(): string
  onFlush(markdown: string): void
}

export interface MarkdownSync {
  schedule(): void
  flushNow(): void
  dispose(): void
  readonly pending: boolean
}

export function createMarkdownSync(options: MarkdownSyncOptions): MarkdownSync {
  const delayMs = options.delayMs ?? 300
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false

  const clearTimer = (): void => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  const flush = (): void => {
    clearTimer()
    if (!pending) return
    pending = false
    options.onFlush(options.serialize())
  }

  return {
    schedule() {
      pending = true
      clearTimer()
      timer = setTimeout(flush, delayMs)
    },
    flushNow() {
      flush()
    },
    dispose() {
      clearTimer()
      pending = false
    },
    get pending() {
      return pending
    },
  }
}
