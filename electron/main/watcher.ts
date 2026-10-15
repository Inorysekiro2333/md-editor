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
  getCredential(): WriteCredential | null
  onChange(path: string): void
}

export async function createFileWatcher(options: FileWatcherOptions): Promise<FSWatcher> {
  const watcher = chokidar.watch(options.path, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
  })

  const handle = async (changedPath: string): Promise<void> => {
    const info = await fs.stat(changedPath).catch(() => null)
    if (info === null) return
    const credential = options.getCredential()
    if (shouldSuppress(credential, changedPath, info.size, info.mtimeMs, Date.now())) return
    options.onChange(changedPath)
  }

  watcher.on('change', (changedPath) => void handle(changedPath))
  watcher.on('add', (changedPath) => void handle(changedPath))

  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
  return watcher
}
