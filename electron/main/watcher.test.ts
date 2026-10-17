import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeAtomic, type WriteCredential } from './fs_io'
import { createFileWatcher, createWatcherRegistry, shouldSuppress } from './watcher'

function credential(overrides: Partial<WriteCredential> = {}): WriteCredential {
  return {
    path: 'C:/notes/doc.md',
    size: 12,
    mtimeMs: 1_700_000_000_000,
    writtenAtMs: 1_700_000_000_010,
    ...overrides,
  }
}

describe('shouldSuppress', () => {
  it('suppresses an exact credential match on the same path', () => {
    expect(
      shouldSuppress(credential(), 'C:/notes/doc.md', 12, 1_700_000_000_000, 1_700_000_000_100),
    ).toBe(true)
  })

  it('does not suppress a different path', () => {
    expect(
      shouldSuppress(credential(), 'C:/notes/other.md', 12, 1_700_000_000_000, 1_700_000_000_100),
    ).toBe(false)
  })

  it('falls back to the 500ms window when size or mtime drift', () => {
    expect(
      shouldSuppress(credential(), 'C:/notes/doc.md', 99, 1_700_000_000_500, 1_700_000_000_300),
    ).toBe(true)
  })

  it('stops suppressing after the window', () => {
    expect(
      shouldSuppress(credential(), 'C:/notes/doc.md', 99, 1_700_000_000_500, 1_700_000_000_600),
    ).toBe(false)
  })

  it('does not suppress when no credential was recorded', () => {
    expect(shouldSuppress(null, 'C:/notes/doc.md', 1, 1, 1)).toBe(false)
  })
})

describe('createWatcherRegistry', () => {
  it('creates only one watcher for concurrent watch calls on the same path', async () => {
    const created: string[] = []
    const closed: string[] = []
    let release!: () => void
    const registry = createWatcherRegistry({
      createWatcher: (path) =>
        new Promise((resolve) => {
          created.push(path)
          release = () => {
            resolve({
              close: async () => {
                closed.push(path)
              },
            })
          }
        }),
    })

    const first = registry.watch('doc.md')
    const second = registry.watch('doc.md')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(created).toEqual(['doc.md'])

    release()
    await Promise.all([first, second])
    expect(registry.watcherCount()).toBe(1)
    expect(closed).toEqual([])
  })

  it('serializes watch, unwatch, and watch operations in arrival order', async () => {
    const operations: string[] = []
    const registry = createWatcherRegistry({
      createWatcher: async (path) => ({
        close: async () => {
          operations.push(`close:${path}`)
        },
      }),
    })

    await registry.watch('doc.md').then(() => operations.push('watch:1'))
    await registry.unwatch('doc.md').then(() => operations.push('unwatch'))
    await registry.watch('doc.md').then(() => operations.push('watch:2'))

    expect(operations).toEqual(['watch:1', 'close:doc.md', 'unwatch', 'watch:2'])
    expect(registry.watcherCount()).toBe(1)
  })
})

describe('createFileWatcher', () => {
  it('stays silent on self writes but reports external writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'md-editor-watch-'))
    const file = join(dir, 'doc.md')
    await writeFile(file, 'seed\n')

    const events: string[] = []
    let lastCredential: WriteCredential | null = null
    const watcher = await createFileWatcher({
      path: file,
      getCredential: () => lastCredential,
      onChange: (changed) => events.push(changed),
    })

    await new Promise((resolve) => setTimeout(resolve, 300))

    lastCredential = await writeAtomic(file, Buffer.from('self write\n'))
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(events).toHaveLength(0)

    await writeFile(file, 'external write\n')
    const deadline = Date.now() + 5000
    while (events.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    expect(events.length).toBeGreaterThan(0)
    await watcher.close()
  }, 20000)
})
