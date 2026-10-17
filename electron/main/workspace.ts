import chokidar, { type FSWatcher } from 'chokidar'
import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'

const IGNORED_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.svn', '.idea'])
const MD_EXTENSIONS = new Set(['.md', '.markdown'])

export function isMarkdownPath(path: string): boolean {
  return MD_EXTENSIONS.has(extname(path).toLowerCase())
}

/** chokidar ignored：匹配路径中任意一级被忽略目录（含开头/结尾边界）。 */
function ignoredDirPattern(): RegExp {
  const names = [...IGNORED_DIRS].join('|')
  return new RegExp(`(^|[\\\\/])(${names})([\\\\/]|$)`)
}

export interface WorkspaceNode {
  name: string
  path: string
  type: 'dir' | 'file'
  children?: WorkspaceNode[]
}

function sortSiblings(nodes: WorkspaceNode[]): WorkspaceNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function walkDir(dirPath: string): Promise<WorkspaceNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const files: WorkspaceNode[] = []
  const dirJobs: { entryName: string; path: string; children: Promise<WorkspaceNode[] | null> }[] =
    []

  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      // 读失败的子目录（权限/竞态删除）按无内容处理，不中断整棵树。
      dirJobs.push({
        entryName: entry.name,
        path: entryPath,
        children: walkDir(entryPath).catch(() => null),
      })
    } else if (entry.isFile() && isMarkdownPath(entry.name)) {
      files.push({ name: entry.name, path: entryPath, type: 'file' })
    }
  }

  const nodes = [...files]
  const childLists = await Promise.all(dirJobs.map((job) => job.children))
  dirJobs.forEach((job, index) => {
    const children = childLists[index]
    // 目录含可显示内容才输出。
    if (children === null || children.length === 0) return
    nodes.push({ name: job.entryName, path: job.path, type: 'dir', children })
  })

  return sortSiblings(nodes)
}

export async function walkWorkspace(dir: string): Promise<WorkspaceNode[]> {
  return walkDir(dir)
}

export interface WorkspaceUpdate {
  added: string[]
  removed: string[]
}

export interface WorkspaceWatcherOptions {
  dir: string
  onUpdate(update: WorkspaceUpdate): void
}

const BATCH_WINDOW_MS = 100

/**
 * 增量 watcher：add/unlink 只收 md 文件，100ms 批量合并推送。
 * initial scan 交给 chokidar（ignoreInitial），树全量走 walkWorkspace。
 */
export async function createWorkspaceWatcher(options: WorkspaceWatcherOptions): Promise<FSWatcher> {
  const watcher = chokidar.watch(options.dir, {
    ignoreInitial: true,
    ignored: ignoredDirPattern(),
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
  })

  let added: string[] = []
  let removed: string[] = []
  let timer: NodeJS.Timeout | null = null

  const flush = (): void => {
    timer = null
    const update: WorkspaceUpdate = { added, removed }
    added = []
    removed = []
    if (update.added.length > 0 || update.removed.length > 0) {
      options.onUpdate(update)
    }
  }

  const queue = (list: string[], path: string): void => {
    list.push(path)
    if (timer === null) {
      timer = setTimeout(flush, BATCH_WINDOW_MS)
    }
  }

  watcher.on('add', (path) => {
    if (isMarkdownPath(path)) queue(added, path)
  })
  watcher.on('unlink', (path) => {
    if (isMarkdownPath(path)) queue(removed, path)
  })
  watcher.on('error', (error) => {
    console.error('[workspace] watcher error', error)
  })

  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
  return watcher
}
