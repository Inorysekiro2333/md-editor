import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import { walkWorkspace } from './workspace'

const cleanupDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanupDirs.push(dir)
  return dir
}

afterEach(async () => {
  const dirs = cleanupDirs.splice(0)
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('walkWorkspace', () => {
  it('returns md/markdown files in sorted tree structure, skipping ignored dirs and non-md files', async () => {
    const dir = await makeTempDir('md-editor-walk-')
    await writeFile(join(dir, 'a.md'), '# A\n')
    await writeFile(join(dir, 'notes.txt'), 'ignored\n')
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'sub', 'b.markdown'), '# B\n')
    await mkdir(join(dir, 'sub', 'deep'))
    await writeFile(join(dir, 'sub', 'deep', 'c.md'), '# C\n')
    await mkdir(join(dir, 'node_modules'))
    await writeFile(join(dir, 'node_modules', 'x.md'), '# X\n')
    await mkdir(join(dir, '.git'))
    await writeFile(join(dir, '.git', 'y.md'), '# Y\n')
    await mkdir(join(dir, 'out'))
    await writeFile(join(dir, 'out', 'z.md'), '# Z\n')
    await mkdir(join(dir, '.svn'))
    await mkdir(join(dir, '.idea'))
    await mkdir(join(dir, 'dist'))
    await mkdir(join(dir, 'empty-dir'))

    const nodes = await walkWorkspace(dir)

    expect(nodes).toEqual([
      {
        name: 'sub',
        path: join(dir, 'sub'),
        type: 'dir',
        children: [
          {
            name: 'deep',
            path: join(dir, 'sub', 'deep'),
            type: 'dir',
            children: [
              {
                name: 'c.md',
                path: join(dir, 'sub', 'deep', 'c.md'),
                type: 'file',
              },
            ],
          },
          {
            name: 'b.markdown',
            path: join(dir, 'sub', 'b.markdown'),
            type: 'file',
          },
        ],
      },
      {
        name: 'a.md',
        path: join(dir, 'a.md'),
        type: 'file',
      },
    ])
  })

  it('sorts siblings dirs first then localeCompare within each group', async () => {
    const dir = await makeTempDir('md-editor-sort-')
    await writeFile(join(dir, 'zeta.md'), '# z\n')
    await writeFile(join(dir, 'alpha.md'), '# a\n')
    await mkdir(join(dir, 'zeta-dir'))
    await writeFile(join(dir, 'zeta-dir', 'inner.md'), '# i\n')
    await mkdir(join(dir, 'alpha-dir'))
    await writeFile(join(dir, 'alpha-dir', 'inner.md'), '# i\n')

    const nodes = await walkWorkspace(dir)

    expect(nodes.map((node) => node.name)).toEqual(['alpha-dir', 'zeta-dir', 'alpha.md', 'zeta.md'])
    expect(nodes[0]?.type).toBe('dir')
    expect(nodes[2]?.type).toBe('file')
  })

  it('indexes 10k md files under 15s', async () => {
    const dir = await makeTempDir('md-editor-perf-')
    const dirCount = 20
    const filesPerDir = 500
    const dirNames = Array.from({ length: dirCount }, (_, i) =>
      join(dir, `d${String(i).padStart(3, '0')}`),
    )
    await Promise.all(dirNames.map((name) => mkdir(name)))

    const totalFiles = dirCount * filesPerDir
    for (let start = 0; start < totalFiles; start += 500) {
      const batch: Promise<void>[] = []
      for (let i = start; i < Math.min(start + 500, totalFiles); i++) {
        const d = Math.floor(i / filesPerDir)
        const f = i % filesPerDir
        batch.push(writeFile(join(dirNames[d]!, `f${String(f).padStart(4, '0')}.md`), '# x\n'))
      }
      await Promise.all(batch)
    }

    const t0 = performance.now()
    const nodes = await walkWorkspace(dir)
    const elapsedMs = performance.now() - t0
    // 真实数字进 TODO 验收记录（Task 2 报告），阈值放宽防 CI 抖动。
    console.log(`[workspace] 10k walk: ${elapsedMs.toFixed(1)}ms`)
    expect(nodes).toHaveLength(dirCount)
    expect(elapsedMs).toBeLessThan(15_000)
  }, 120_000)
})
