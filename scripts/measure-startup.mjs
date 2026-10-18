import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fixture = join(tmpdir(), `md-editor-measure-${Date.now()}.md`)
writeFileSync(fixture, '# measure\n\nbody\n')

function runOnce(extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['electron', 'out/main/index.js', '--open', fixture, ...extraArgs],
      {
        env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-m-')) },
        shell: process.platform === 'win32',
      },
    )
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => resolve({ code, out }))
    setTimeout(() => child.kill(), 20000)
  })
}

// 第一次启动含系统一次性开销，第二次起才是要记录的口径
await runOnce()
const second = await runOnce()
const readyMs = Number(second.out.match(/\[startup\] ready (\d+)/)?.[1] ?? 'NaN')

const memoryFile = join(tmpdir(), `md-editor-mem-${Date.now()}.json`)
await runOnce(['--probe-memory', memoryFile])
const metrics = JSON.parse(readFileSync(memoryFile, 'utf8'))
const totalMb = Math.round(
  metrics.reduce((sum, metric) => sum + (metric.memory?.workingSetSize ?? 0), 0) / 1024,
)

let artifact = '未打包（请先执行 pnpm build）'
try {
  artifact = `${Math.round(statSync(join('release', 'md-editor Setup 0.1.0.exe')).size / 1024 / 1024)}MB`
} catch {
  // 保持默认提示
}

console.log(
  `| 2026-10-15 | <commit> | ${artifact} | ${readyMs}ms | ${totalMb}MB | 未测（M1） | win32；内存=所有进程 workingSetSize 之和 |`,
)
if (!Number.isFinite(readyMs)) process.exit(1)
process.exit(0)
