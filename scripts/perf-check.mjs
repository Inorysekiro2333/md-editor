// perf:check - M5 release acceptance thresholds (architecture.md 5)
// ready < 3000ms; private working set <= 300MB; each installer in release/ <= 150MB
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const INSTALLER_LIMIT_MB = 150
const MEMORY_LIMIT_MB = 300
const READY_LIMIT_MS = 3000

function fail(msg) {
  console.error(`perf-check: ${msg}`)
  process.exit(1)
}

// ---- 冷启动 ready：复用 scripts/measure-startup.mjs 的采样 ----
const r = spawnSync(process.execPath, ['scripts/measure-startup.mjs'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
if (r.status !== 0) {
  fail('measure-startup 失败')
}
const line = r.stdout.trim().split(/\r?\n/).at(-1)
const cols = line.split('|').map((c) => c.trim())
const readyMs = Number(cols[4]?.replace(/ms$/, ''))
if (!Number.isFinite(readyMs)) {
  fail(`无法解析 measure-startup 输出: ${line}`)
}

const fixture = join(tmpdir(), `md-editor-perf-${Date.now()}.md`)
writeFileSync(fixture, '# perf-check\n\nbody\n')

// ---- 启动一次 app，resolve 于「收到 [startup] ready 输出」；
// 提前退出（闪退）必须失败，禁止把闪退当 ready。 ----
function runApp(extraArgs = [], timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['electron', 'out/main/index.js', '--open', fixture, ...extraArgs],
      {
        env: {
          ...process.env,
          MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-perf-')),
        },
        shell: process.platform === 'win32',
      },
    )
    let out = ''
    let done = false
    const killTree = () => {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        child.kill()
      }
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      killTree()
      reject(new Error('等待 ready 超时'))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      out += chunk.toString()
      if (!done && out.includes('[startup] ready')) {
        done = true
        clearTimeout(timer)
        resolve(child)
      }
    })
    child.on('error', (e) => {
      if (!done) {
        done = true
        clearTimeout(timer)
        reject(e)
      }
    })
    child.on('exit', (code) => {
      if (!done) {
        done = true
        clearTimeout(timer)
        reject(new Error(`app 在输出 ready 前提前退出 (code=${code})，疑似闪退`))
      }
    })
  })
}

function waitExit(child) {
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(code))
  })
}

function electronPidsSync() {
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

// ---- 私有工作集：优先 --probe-memory JSON 的 privateWorkingSet；缺失时回退。
// 回退口径：Windows 用 Get-Process 私有内存（PrivateMemorySize64）之和；
// 非 Windows 且 probe 无 privateWorkingSet 时直接失败，禁止采成 0MB 假 PASS。
async function sampleMemory() {
  const probeFile = join(tmpdir(), `md-editor-probe-${Date.now()}.json`)
  try {
    const child = await runApp(['--probe-memory', probeFile])
    await waitExit(child)
    if (existsSync(probeFile)) {
      const metrics = JSON.parse(readFileSync(probeFile, 'utf8'))
      let sum = 0
      let hasPws = false
      for (const metric of metrics) {
        const pws = metric.memory?.privateWorkingSet
        if (Number.isFinite(pws)) {
          hasPws = true
          sum += pws
        }
      }
      if (hasPws) {
        return {
          mb: Math.round(sum / 1024 / 1024),
          scope: '--probe-memory privateWorkingSet 之和',
        }
      }
    }
  } catch (e) {
    fail(`probe 内存采样失败: ${e.message}`)
  }
  if (process.platform !== 'win32') {
    fail(
      '私有工作集采样仅支持 Windows（probe JSON 无 privateWorkingSet 时回退 Get-Process；' +
        '如需支持其他平台，请让 --probe-memory 输出 privateWorkingSet 后替代）',
    )
  }
  const before = electronPidsSync()
  let child
  try {
    child = await runApp()
  } catch (e) {
    fail(`app 启动失败: ${e.message}`)
  }
  const after = electronPidsSync()
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill()
  }
  let sum = 0
  for (const [id, bytes] of after) {
    if (!before.has(id)) sum += bytes
  }
  return {
    mb: Math.round(sum / 1024 / 1024),
    scope:
      'Get-Process electron 私有内存(PrivateMemorySize64)之和（probe JSON 无 privateWorkingSet，回退）',
  }
}

const { mb: memoryMb, scope: memoryScope } = await sampleMemory()

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
if (memoryMb > MEMORY_LIMIT_MB) {
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
