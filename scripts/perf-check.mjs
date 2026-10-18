// perf:check - M5 release acceptance thresholds (architecture.md 5)
// ready < 3000ms; private working set <= 300MB; each installer in release/ <= 150MB
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const INSTALLER_LIMIT_MB = 150
const MEMORY_LIMIT_MB = 300
const READY_LIMIT_MS = 3000

// ---- 冷启动 ready：复用 scripts/measure-startup.mjs 的采样 ----
const r = spawnSync(process.execPath, ['scripts/measure-startup.mjs'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
if (r.status !== 0) {
  console.error('perf-check: measure-startup 失败')
  process.exit(1)
}
const line = r.stdout.trim().split(/\r?\n/).at(-1)
const cols = line.split('|').map((c) => c.trim())
const readyMs = Number(cols[4]?.replace(/ms$/, ''))
if (!Number.isFinite(readyMs)) {
  console.error(`perf-check: 无法解析 measure-startup 输出: ${line}`)
  process.exit(1)
}

// ---- 私有工作集：优先 --probe-memory JSON 的 privateWorkingSet；缺失时回退。
// 回退口径：Windows 用 Get-Process 私有内存之和（与 development.md 第 7 节 M1 口径一致，
// workingSetSize 含共享内存，不能直接当私有工作集阈值用）。
async function electronPids() {
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      'Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) $($_.PrivateMemorySize64)" }',
    ],
    { encoding: 'utf8' },
  )
  return new Map(
    r.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        const [id, bytes] = l.split(' ')
        return [Number(id), Number(bytes)]
      }),
  )
}

const fixture = join(tmpdir(), `md-editor-perf-${Date.now()}.md`)
writeFileSync(fixture, '# perf-check\n\nbody\n')
const before = await electronPids()
const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron', 'out/main/index.js', '--open', fixture],
  {
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-perf-')) },
    shell: process.platform === 'win32',
  },
)
let out = ''
let memoryMb = NaN
let memoryScope = ''
try {
  memoryMb = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 ready 超时')), 30000)
    child.stdout.on('data', (chunk) => {
      out += chunk.toString()
      if (out.includes('[startup] ready')) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.on('error', reject)
    child.on('exit', () => resolve())
  }).then(async () => {
    // ready 已到，采样新增 electron 进程私有内存之和
    const after = await electronPids()
    let sum = 0
    for (const [id, bytes] of after) {
      if (!before.has(id)) sum += bytes
    }
    memoryScope =
      'Get-Process electron 私有内存(PrivateMemorySize64)之和（privateWorkingSet 缺失，回退）'
    return Math.round(sum / 1024 / 1024)
  })
} catch (e) {
  console.error(`perf-check: 私有工作集采样失败: ${e.message}`)
} finally {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill()
  }
}

// ---- 判定 ----
let failed = false
console.log(`perf-check: ready = ${readyMs}ms (阈值 <${READY_LIMIT_MS}ms)`)
if (readyMs >= READY_LIMIT_MS) {
  console.error('perf-check: FAIL 冷启动超阈值')
  failed = true
}
console.log(
  `perf-check: 私有工作集 = ${memoryMb}MB (阈值 ≤${MEMORY_LIMIT_MB}MB；口径：${memoryScope})`,
)
if (!Number.isFinite(memoryMb)) {
  console.error('perf-check: FAIL 私有工作集采样失败')
  failed = true
} else if (memoryMb > MEMORY_LIMIT_MB) {
  console.error('perf-check: FAIL 私有工作集超阈值')
  failed = true
}

const exts = ['.exe', '.dmg', '.AppImage', '.deb']
let artifacts = []
try {
  artifacts = readdirSync('release').filter((f) => exts.some((e) => f.endsWith(e)))
} catch {
  // release/ 不存在视为无产物
}
if (artifacts.length === 0) {
  console.log('perf-check: SKIP 安装包体积（release/ 无产物，待 Release CI 后检查）')
} else {
  for (const f of artifacts) {
    const mb = statSync(join('release', f)).size / 1024 / 1024
    console.log(`perf-check: 安装包 ${f} = ${mb.toFixed(1)}MB (阈值 ≤${INSTALLER_LIMIT_MB}MB)`)
    if (mb > INSTALLER_LIMIT_MB) {
      console.error(`perf-check: FAIL ${f} 超阈值`)
      failed = true
    }
  }
}
process.exit(failed ? 1 : 0)
