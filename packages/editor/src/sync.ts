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
      // M2 语义变更（handoff §5）：dispose 先同步 flush pending，
      // unmount 时不再丢 Buffer 收敛；再清理 timer。
      flush()
      // onFlush 重入 schedule 时（flush 后重新 pending），保留新 timer，
      // 让重入的那一轮照常收敛；否则才清理残留 timer（Task 8 清理波）。
      if (!pending) clearTimer()
    },
    get pending() {
      return pending
    },
  }
}
