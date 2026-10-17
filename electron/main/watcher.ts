import chokidar, { type FSWatcher } from 'chokidar'
import { promises as fs } from 'node:fs'
import type { WriteCredential } from './fs_io'

const SUPPRESS_WINDOW_MS = 500

export function shouldSuppress(
  credential: WriteCredential | null,
  eventPath: string,
  size: number,
  mtimeMs: number,
  nowMs: number,
): boolean {
  if (credential === null) return false
  if (credential.path !== eventPath) return false
  if (credential.size === size && credential.mtimeMs === mtimeMs) return true
  return nowMs - credential.writtenAtMs <= SUPPRESS_WINDOW_MS
}

export interface FileWatcherOptions {
  path: string
  getCredential(path: string): WriteCredential | null
  onChange(path: string): void
}

export interface CloseableWatcher {
  close(): Promise<void>
}

export interface WatcherRegistryOptions {
  createWatcher(path: string): Promise<CloseableWatcher>
}

export interface WatcherRegistry {
  watch(path: string): Promise<void>
  unwatch(path: string): Promise<void>
  enqueue<T>(operation: () => Promise<T>): Promise<T>
  closeAll(): Promise<void>
  watcherCount(): number
}

export function createWatcherRegistry(options: WatcherRegistryOptions): WatcherRegistry {
  const watchers = new Map<string, CloseableWatcher>()
  let chain: Promise<unknown> = Promise.resolve()

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    // watch/unwatch/openWorkspace/dispose 都改 watcher 状态，必须按到达顺序串行。
    const operationResult = chain.then(operation, operation)
    chain = operationResult.catch(() => undefined)
    return operationResult
  }

  return {
    watch(path) {
      return enqueue(async () => {
        if (watchers.has(path)) return
        watchers.set(path, await options.createWatcher(path))
      })
    },
    unwatch(path) {
      return enqueue(async () => {
        const watcher = watchers.get(path)
        if (watcher === undefined) return
        watchers.delete(path)
        await watcher.close()
      })
    },
    enqueue(operation) {
      return enqueue(operation)
    },
    async closeAll() {
      const closing = [...watchers.values()].map((watcher) => watcher.close())
      watchers.clear()
      await Promise.all(closing)
    },
    watcherCount() {
      return watchers.size
    },
  }
}

export async function createFileWatcher(options: FileWatcherOptions): Promise<FSWatcher> {
  const watcher = chokidar.watch(options.path, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
  })

  const handle = async (changedPath: string): Promise<void> => {
    const info = await fs.stat(changedPath).catch(() => null)
    if (info === null) return
    const credential = options.getCredential(changedPath)
    if (shouldSuppress(credential, changedPath, info.size, info.mtimeMs, Date.now())) return
    options.onChange(changedPath)
  }

  watcher.on('change', (changedPath) => void handle(changedPath))
  watcher.on('add', (changedPath) => void handle(changedPath))
  watcher.on('error', (error) => {
    console.error('[watcher] error', error)
  })

  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
  return watcher
}
