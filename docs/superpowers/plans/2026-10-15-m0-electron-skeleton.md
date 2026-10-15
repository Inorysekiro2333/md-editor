# md-editor M0（Electron 骨架）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 md-editor 的最小可运行闭环——Electron 壳里打开 `.md` → Milkdown 所见即所得编辑 → `Ctrl+S` 原子保存（未编辑则完全不写盘）→ 外部修改自动重载，并记录一次真实的性能基线。

**Architecture:** `electron/main` 是唯一有权访问 Node 的进程（窗口、fs_io、chokidar 监听、打印导出）；`electron/preload` 通过 `contextBridge` 暴露白名单接口；渲染进程（`packages/app`）无 Node 权限，持有 `MdDocument`（Buffer 唯一事实源）并挂载 `packages/editor` 的 Milkdown 编辑器。mdast ↔ PM 转换由 Milkdown 内置承担，仓库内**没有** `packages/md-bridge`。

**Tech Stack:** Electron 44.7.2 + electron-vite 6.0.0 + React 18.3.1 + TypeScript 5.9.3 + Vite 8.3.4 + Milkdown 7.22.3 + Zustand 5 + chokidar 5 + Vitest 5.0.4 + Playwright 1.64.1（`_electron`）+ electron-builder 26.15.3 + ESLint 9 + pnpm 11

**Spec:** `AGENTS.md` · `architecture.md`（2.3 安全基线 / 3.1–3.5 / ADR-1..7 / 5 节性能预算）· `component-api.md`（1.1 / 1.2 / 2 / 3）· `development.md`（1–8 节）· `TODO.md`（M0 段）

## Global Constraints

- 唯一事实源：Markdown Buffer 是权威，PM Doc 只是投影；渲染模式键入允许 PM Doc 短暂领先，但必须在 300ms 防抖窗口内收敛回 Buffer（`architecture.md` 3.2）。
- **零编辑保存 = 不写盘**：Buffer 未被编辑时 `Ctrl+S` 必须完全跳过写入事务，磁盘内容天然不变（`architecture.md` 3.3、`AGENTS.md` 铁律 1）。
- 编辑后的序列化差异必须逐条登记为测试用例，禁止静默规范化（`development.md` 6 节 R1）。
- 渲染进程**不得**有 Node 能力：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；一切文件操作走 `electron/preload` 白名单（`architecture.md` 2.3）。
- 编辑内核唯一 Milkdown；源码模式唯一 CodeMirror 6；禁止引入第二套解析/编辑内核（`AGENTS.md` 铁律 3）。
- 依赖方向：`app → editor / export / theming`；三者互不依赖且不得依赖 `app`（`development.md` 3 节）。
- TypeScript strict，禁止 `any`（`development.md` 4 节）。
- 提交信息英文祈使句 + scope，如 `feat(main): add atomic write`（`development.md` 4 节）。
- 性能口径（权威值在 `architecture.md` 5 节）：安装包（下载体积）≤150MB · 安装后 ≤400MB · 冷启动（第二次及以后）< 3s · 空文档常驻内存 ≤300MB（单窗口 / release / 全部进程私有工作集之和）。
- **本计划不含 M2 的 `cursor-map`**：M0 只要求 Buffer 是唯一事实源、Milkdown Doc 可由 Buffer 完整重建，不得为后续光标映射制造障碍。
- 环境：Node ≥ 20.19（实测 24.11.0）、pnpm ≥ 9（实测 11.25.0）；**不需要 Rust / MSVC / WSL**。

## 关键技术决策（写进实现，避免踩坑）

| 决策                                                                                         | 原因                                                                          |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 用 `electron-vite` 统一管理 main / preload / renderer 三份构建                               | 官方模板化方案，dev 模式自带 renderer HMR 与主进程重启                        |
| `package.json` **不设** `"type": "module"`，主进程与 preload 产物为 CJS                      | `sandbox: true` 下 preload 必须是 CJS（Electron 硬约束，安全基线不可放宽）    |
| `chokidar@5` **必须打进主进程 bundle**（`externalizeDepsPlugin({ exclude: ['chokidar'] })`） | chokidar 5 是 ESM-only（`"type": "module"`），CJS 主进程 `require` 会直接失败 |
| `.npmrc` **不设** `auto-install-peers=true`                                                  | 避免为 electron-vite 的可选 peer `@swc/core` 自动装入几十 MB 依赖             |
| e2e 用 `--open <path>` CLI 参数打开固定 fixture                                              | 避免在自动化里驱动系统文件对话框；同时为 M5 的文件关联/命令行打开打基础       |
| 性能基线用"打包后产物 + 第二次启动"测量                                                      | 首次启动含系统 Defender 扫描等一次性开销，文档已单独放宽                      |

## File Structure

```text
.gitignore / .npmrc / .editorconfig / .prettierrc.json / .prettierignore
package.json                    根脚本与 devDependencies（含 electron / electron-vite / electron-builder）
pnpm-workspace.yaml             workspace 成员（packages/*）
tsconfig.base.json / tsconfig.node.json / packages/app/tsconfig.json
electron.vite.config.ts         main / preload / renderer 三份构建配置
eslint.config.mjs               ESLint 9 flat config
playwright.config.ts            Playwright 配置（Electron 项目）
scripts/theme-check.mjs         theme:check 占位（M4 实现真实校验）
scripts/measure-startup.mjs     性能基线测量（冷启动 / 内存 / 包体）

electron/shared/channels.ts     通道常量（主进程与 preload 共用，避免拼写漂移）
electron/main/index.ts          应用入口：单实例锁、--open 参数、窗口创建
electron/main/window.ts         窗口创建与安全基线
electron/main/fs_io.ts          读文件（BOM/EOL/UTF-8 校验）+ 原子写 + 写入凭证
electron/main/watcher.ts        chokidar 单文件监听 + 自身写入抑制
electron/main/ipc.ts            IPC handler 注册
electron/main/export.ts         printToPDF / HTML 落盘（M0 只做冒烟所需的最小实现）
electron/preload/index.ts       contextBridge 白名单接口

packages/app/index.html         渲染进程 HTML（含 CSP meta）
packages/app/src/main.tsx       React 入口
packages/app/src/App.tsx        工作台编排：打开 / 编辑 / 保存 / 外部重载
packages/app/src/app.css        基于 DESIGN.md token 的样式
packages/app/src/ipc.ts         渲染进程侧 IPC 封装（唯一出口）
packages/app/src/document/MdDocument.ts / MdDocument.test.ts
packages/app/src/state/appStore.ts
packages/editor/src/EditorHost.tsx   Milkdown 封装组件
packages/editor/src/sync.ts / sync.test.ts  300ms 防抖收敛
packages/editor/src/index.ts

e2e/shell.spec.ts               窗口与安全基线冒烟
e2e/open-save.spec.ts           打开 / 编辑 / 保存 / 零编辑不写盘
e2e/external-change.spec.ts     外部修改自动重载 + 自身写入不误报
e2e/fixtures/sample.md          测试用 Markdown
.github/workflows/ci.yml        前端门禁 + 三平台构建干跑
```

---

### Task 1: 仓库骨架与工具链

**Files:**

- Create: `.gitignore`、`.npmrc`、`.editorconfig`、`.prettierrc.json`、`.prettierignore`、`package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`tsconfig.node.json`
- Create: `scripts/theme-check.mjs`

**Interfaces:**

- Consumes: 本机已具备的 Node 24 / pnpm 11 / git
- Produces: 根脚本 `pnpm dev` / `build` / `build:app` / `test` / `typecheck` / `lint` / `e2e` / `theme:check`；workspace 成员 `packages/*`

- [x] **Step 1: 初始化 git 仓库**

```powershell
git init -b main
```

- [x] **Step 2: 写忽略、包管理与格式化配置**

`.gitignore`:

```gitignore
node_modules/
out/
dist/
release/
coverage/
playwright-report/
test-results/
*.log
.DS_Store
```

`.npmrc`:

```ini
engine-strict=true
```

`.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
```

`.prettierrc.json`:

```json
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```

`.prettierignore`:

```text
node_modules
out
dist
release
coverage
pnpm-lock.yaml
```

- [x] **Step 3: 写根 `package.json`**

```json
{
  "name": "md-editor",
  "version": "0.1.0",
  "private": true,
  "description": "Open-source cross-platform WYSIWYG Markdown editor",
  "main": "./out/main/index.js",
  "packageManager": "pnpm@11.25.0",
  "engines": { "node": ">=20.19" },
  "scripts": {
    "dev": "electron-vite dev",
    "build:app": "electron-vite build",
    "build": "pnpm build:app && electron-builder",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p packages/app/tsconfig.json",
    "lint": "eslint . && prettier --check .",
    "format": "prettier --write .",
    "e2e": "pnpm build:app && playwright test",
    "e2e:install": "playwright install chromium",
    "theme:check": "node scripts/theme-check.mjs"
  },
  "devDependencies": {
    "@eslint/js": "9.39.5",
    "@playwright/test": "1.64.1",
    "@types/node": "^24.0.0",
    "@vitejs/plugin-react": "6.1.2",
    "@vitest/coverage-v8": "5.0.4",
    "electron": "44.7.2",
    "electron-builder": "26.15.3",
    "electron-vite": "6.0.0",
    "eslint": "9.39.5",
    "eslint-plugin-react-hooks": "7.1.1",
    "globals": "^16.0.0",
    "playwright": "1.64.1",
    "prettier": "3.9.10",
    "typescript": "5.9.3",
    "typescript-eslint": "8.71.2",
    "vite": "8.3.4",
    "vitest": "5.0.4"
  }
}
```

> 注意：`main` 指向 electron-vite 的构建产物 `./out/main/index.js`；不设 `"type": "module"`（见「关键技术决策」）。

- [x] **Step 4: 写 workspace 与 TS 基线**

`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  }
}
```

`tsconfig.node.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "types": ["node", "electron-vite/node"]
  },
  "include": ["electron/**/*.ts", "electron.vite.config.ts"]
}
```

- [x] **Step 5: 写 `theme:check` 占位脚本**

`scripts/theme-check.mjs`:

```js
// theme:check 的真实校验在 M4 交付（见 development.md 2 节与 TODO.md M4）。
// M0 阶段显式失败，避免 CI 误以为主题已经通过校验。
console.error('theme:check 尚未实现：主题规范校验属于 M4（见 TODO.md M4）')
process.exit(1)
```

- [x] **Step 6: 安装并验证**

Run: `pnpm install`

Expected: 生成 `pnpm-lock.yaml`；安装日志里**没有** `@swc/core` 被自动装入；`pnpm exec electron --version` 输出 `v44.7.2`。

- [x] **Step 7: 提交**

```bash
git add .
git commit -m "chore(repo): bootstrap electron workspace"
```

---

### Task 2: Electron 三进程壳 + preload 契约 + Playwright 冒烟

**Files:**

- Create: `electron.vite.config.ts`、`electron/shared/channels.ts`、`electron/main/index.ts`、`electron/main/window.ts`、`electron/main/security.ts`、`electron/main/security.test.ts`、`electron/preload/index.ts`
- Create: `packages/app/package.json`、`packages/app/tsconfig.json`、`packages/app/index.html`、`packages/app/src/main.tsx`、`packages/app/src/App.tsx`、`packages/app/src/app.css`、`packages/app/src/bridge.d.ts`
- Create: `playwright.config.ts`、`e2e/shell.spec.ts`

**Interfaces:**

- Consumes: Task 1 的根脚本与 workspace
- Produces:
  - `CHANNELS`（`electron/shared/channels.ts`）：`appInfo: 'app:info'`（M0 期间陆续增加）
  - `createMainWindow(): BrowserWindow`
  - `buildCsp(isDev: boolean): string`
  - `window.mdEditor.getAppInfo(): Promise<{ version: string; electron: string }>`

- [x] **Step 1: 写失败的冒烟测试**

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
})
```

`e2e/shell.spec.ts`:

```ts
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface MdEditorApi {
  getAppInfo(): Promise<{ version: string; electron: string }>
}

test('opens a window with the preload bridge and no node access', async () => {
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
  const window = await app.firstWindow()

  await expect(window).toHaveTitle('md-editor')

  const bridgeType = await window.evaluate(
    () => typeof (window as unknown as { mdEditor?: unknown }).mdEditor,
  )
  expect(bridgeType).toBe('object')

  const nodeLeak = await window.evaluate(
    () => typeof (window as unknown as { require?: unknown }).require,
  )
  expect(nodeLeak).toBe('undefined')

  const appInfo = await window.evaluate(() =>
    (window as unknown as { mdEditor: MdEditorApi }).mdEditor.getAppInfo(),
  )
  expect(appInfo.electron).toBe('44.7.2')

  await expect(window.locator('[data-testid="app-info"]')).toContainText('Electron')

  await app.close()
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm e2e`

Expected: FAIL —— 构建产物不存在（`out/main/index.js` 缺失）或 Electron 启动失败，证明测试确实在验证真实产物。

- [x] **Step 3: 写 electron-vite 三进程配置**

`electron.vite.config.ts`:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    // chokidar 5 是 ESM-only，必须打进 bundle，不能留给 CJS 主进程 require
    plugins: [externalizeDepsPlugin({ exclude: ['chokidar'] })],
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { index: resolve(__dirname, 'electron/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: { index: resolve(__dirname, 'electron/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'packages/app'),
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: { input: { index: resolve(__dirname, 'packages/app/index.html') } },
    },
  },
})
```

- [x] **Step 4: 写通道常量与安全策略（含单测）**

`electron/shared/channels.ts`:

```ts
export const CHANNELS = {
  appInfo: 'app:info',
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]
```

`electron/main/security.ts`:

```ts
export function buildCsp(isDev: boolean): string {
  return [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    isDev ? 'connect-src http://localhost:* ws://localhost:*' : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ')
}
```

`electron/main/security.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildCsp } from './security'

describe('buildCsp', () => {
  it('never allows unsafe-eval', () => {
    expect(buildCsp(true)).not.toContain('unsafe-eval')
    expect(buildCsp(false)).not.toContain('unsafe-eval')
  })

  it('keeps the production policy free of dev-only privileges', () => {
    const prod = buildCsp(false)
    expect(prod).toContain("script-src 'self'")
    expect(prod).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(prod).not.toContain('localhost')
  })

  it('allows vite hmr websockets only in development', () => {
    expect(buildCsp(true)).toContain('ws://localhost:*')
    expect(buildCsp(false)).not.toContain('ws://localhost:*')
  })
})
```

- [x] **Step 5: 写主进程窗口与入口**

`electron/main/window.ts`:

```ts
import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

export const SECURITY_BASELINE = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
} as const

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    title: 'md-editor',
    webPreferences: {
      ...SECURITY_BASELINE,
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
```

`electron/main/index.ts`:

```ts
import { app, BrowserWindow, ipcMain, session } from 'electron'
import { CHANNELS } from '../shared/channels'
import { buildCsp } from './security'
import { createMainWindow } from './window'

const userDataOverride = process.env['MD_EDITOR_USER_DATA']
if (userDataOverride) {
  app.setPath('userData', userDataOverride)
}

let mainWindow: BrowserWindow | null = null

function registerIpc(): void {
  ipcMain.handle(CHANNELS.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
  }))
}

function installCsp(): void {
  const policy = buildCsp(!app.isPackaged)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
    })
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    installCsp()
    registerIpc()
    mainWindow = createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
```

- [x] **Step 6: 写 preload 契约**

`electron/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '../shared/channels'

export interface AppInfo {
  version: string
  electron: string
}

export interface MdEditorBridge {
  getAppInfo(): Promise<AppInfo>
}

const bridge: MdEditorBridge = {
  getAppInfo: () => ipcRenderer.invoke(CHANNELS.appInfo) as Promise<AppInfo>,
}

contextBridge.exposeInMainWorld('mdEditor', bridge)
```

> 只暴露白名单方法，**不**把 `ipcRenderer` 本体交给渲染进程；后续任务在此文件逐个追加方法。

- [x] **Step 7: 写渲染进程最小壳**

`packages/app/package.json`:

```json
{
  "name": "@md-editor/app",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "5.9.3"
  }
}
```

> 本任务**不**声明 `@md-editor/editor` —— 该包在 Task 6 才创建，提前声明会让 `pnpm install` 直接失败。

`packages/app/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`packages/app/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>md-editor</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

`packages/app/src/bridge.d.ts`:

```ts
export interface AppInfo {
  version: string
  electron: string
}

export interface MdEditorBridge {
  getAppInfo(): Promise<AppInfo>
}

declare global {
  interface Window {
    mdEditor: MdEditorBridge
  }
}
```

`packages/app/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './app.css'

const container = document.getElementById('root')
if (container === null) throw new Error('missing #root container')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`packages/app/src/App.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { AppInfo } from './bridge'

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.mdEditor.getAppInfo().then(setInfo)
  }, [])

  return (
    <main className="workspace">
      <p data-testid="app-info">
        {info === null ? '加载中…' : `md-editor ${info.version} · Electron ${info.electron}`}
      </p>
    </main>
  )
}
```

`packages/app/src/app.css`:

```css
:root {
  --bg: #ffffff;
  --fg: #24292f;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, sans-serif;
}

.workspace {
  padding: 16px;
}
```

> 这里只放最小样式；`DESIGN.md` 的完整 token 表在 M4 主题系统落地时统一注入，M0 不复制一遍。

- [x] **Step 8: 安装依赖并跑通冒烟**

Run: `pnpm install; pnpm e2e`

Expected: `pnpm e2e` 先构建再跑 Playwright，1 个用例 PASS（窗口标题、bridge 存在、无 `require`、版本号正确）。

- [x] **Step 9: 手工确认窗口与热更新**

Run: `pnpm dev`

Expected: 弹出 `md-editor` 窗口并显示版本号；改 `App.tsx` 界面热更新；改主进程代码自动重启。

- [x] **Step 10: 提交**

```bash
git add .
git commit -m "feat(main): add electron shell with sandboxed preload bridge"
```

---

### Task 3: 主进程 fs_io —— 读文件元信息 + 原子写 + 写入凭证（TDD）

**Files:**

- Create: `electron/main/fs_io.ts`、`electron/main/fs_io.test.ts`

**Interfaces:**

- Consumes: 无（纯 Node 模块）
- Produces:
  - `interface FileContent { base64: string; text: string; eol: 'lf' | 'crlf'; hasBom: boolean }`
  - `interface WriteCredential { path: string; size: number; mtimeMs: number; writtenAtMs: number }`
  - `readFile(path: string): Promise<FileContent>`
  - `writeAtomic(path: string, bytes: Buffer): Promise<WriteCredential>`

- [x] **Step 1: 写失败测试**

`electron/main/fs_io.test.ts`:

```ts
import { mkdtemp, readFile as readRaw, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readFile, writeAtomic } from './fs_io'

async function fixtureDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'md-editor-fs-'))
}

describe('readFile', () => {
  it('reads utf-8 without BOM and detects lf', async () => {
    const dir = await fixtureDir()
    const file = join(dir, 'doc.md')
    await writeFile(file, '# hi\n')

    const content = await readFile(file)

    expect(content.text).toBe('# hi\n')
    expect(content.eol).toBe('lf')
    expect(content.hasBom).toBe(false)
    expect(Buffer.from(content.base64, 'base64').toString('utf8')).toBe('# hi\n')
  })

  it('strips BOM from text but keeps the original bytes in base64', async () => {
    const dir = await fixtureDir()
    const file = join(dir, 'doc.md')
    const raw = Buffer.from('\uFEFF# hi\r\n', 'utf8')
    await writeFile(file, raw)

    const content = await readFile(file)

    expect(content.text).toBe('# hi\r\n')
    expect(content.eol).toBe('crlf')
    expect(content.hasBom).toBe(true)
    expect(Buffer.from(content.base64, 'base64').equals(raw)).toBe(true)
  })

  it('rejects invalid utf-8 instead of silently replacing bytes', async () => {
    const dir = await fixtureDir()
    const file = join(dir, 'gbk.md')
    await writeFile(file, Buffer.from([0xb0, 0xa1]))

    await expect(readFile(file)).rejects.toThrow(/utf-8/i)
  })
})

describe('writeAtomic', () => {
  it('writes bytes verbatim and returns a credential matching the file on disk', async () => {
    const dir = await fixtureDir()
    const file = join(dir, 'doc.md')
    const raw = Buffer.from('\uFEFF# 标题\r\n', 'utf8')

    const credential = await writeAtomic(file, raw)
    const written = await readRaw(file)
    const info = await stat(file)

    expect(written.equals(raw)).toBe(true)
    expect(credential.path).toBe(file)
    expect(credential.size).toBe(info.size)
    expect(Math.abs(credential.mtimeMs - info.mtimeMs)).toBeLessThan(1)
  })

  it('replaces an existing file and never leaves a tmp file behind', async () => {
    const dir = await fixtureDir()
    const file = join(dir, 'doc.md')
    await writeFile(file, 'old')

    await writeAtomic(file, Buffer.from('new'))

    expect((await readRaw(file)).toString('utf8')).toBe('new')
    await expect(stat(`${file}.tmp`)).rejects.toThrow()
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm test -- electron/main/fs_io.test.ts`

Expected: FAIL —— `./fs_io` 不存在。

- [x] **Step 3: 实现 fs_io**

`electron/main/fs_io.ts`:

```ts
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

export interface FileContent {
  base64: string
  text: string
  eol: 'lf' | 'crlf'
  hasBom: boolean
}

export interface WriteCredential {
  path: string
  size: number
  mtimeMs: number
  writtenAtMs: number
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf])

export function tmpPathFor(path: string): string {
  return `${path}.tmp`
}

export async function readFile(path: string): Promise<FileContent> {
  const raw = await fs.readFile(path)
  const hasBom = raw.length >= 3 && raw.subarray(0, 3).equals(BOM)
  const body = hasBom ? raw.subarray(3) : raw

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    throw new Error(`文件不是有效的 UTF-8，无法打开：${path}`)
  }

  return {
    base64: raw.toString('base64'),
    text,
    eol: text.includes('\r\n') ? 'crlf' : 'lf',
    hasBom,
  }
}

async function syncParentDirectory(target: string): Promise<void> {
  // Windows 不允许以文件句柄方式打开目录，该平台跳过父目录 fsync。
  if (process.platform === 'win32') return
  const handle = await fs.open(dirname(target), 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function writeAtomic(path: string, bytes: Buffer): Promise<WriteCredential> {
  const tmpPath = tmpPathFor(path)

  const handle = await fs.open(tmpPath, 'w')
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await fs.rename(tmpPath, path)
  } catch (error) {
    await fs.rm(tmpPath, { force: true })
    throw error
  }

  await syncParentDirectory(path)

  const info = await fs.stat(path)
  return {
    path,
    size: info.size,
    mtimeMs: info.mtimeMs,
    writtenAtMs: Date.now(),
  }
}
```

> `tmpPathFor` 被 `writeAtomic` 与后续清理逻辑共用；两处必须走同一个函数，否则"写盘失败不留半个文件"会漏删。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm test -- electron/main/fs_io.test.ts`

Expected: PASS（5 个用例）。

- [x] **Step 5: 提交**

```bash
git add electron/main/fs_io.ts electron/main/fs_io.test.ts
git commit -m "feat(main): add atomic file write with bom and eol metadata"
```

---

### Task 4: 主进程 watcher —— chokidar 监听 + 自身写入抑制（TDD + 集成测试）

**Files:**

- Create: `electron/main/watcher.ts`、`electron/main/watcher.test.ts`

**Interfaces:**

- Consumes: Task 3 的 `WriteCredential`
- Produces:
  - `shouldSuppress(credential: WriteCredential | null, eventPath: string, size: number, mtimeMs: number, nowMs: number): boolean`
  - `createFileWatcher(options: { path: string; getCredential(): WriteCredential | null; onChange(path: string): void }): Promise<FSWatcher>`

- [x] **Step 1: 写失败测试（含真实文件集成用例）**

`electron/main/watcher.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeAtomic, type WriteCredential } from './fs_io'
import { createFileWatcher, shouldSuppress } from './watcher'

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
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm test -- electron/main/watcher.test.ts`

Expected: FAIL —— `./watcher` 不存在。

- [x] **Step 3: 实现 watcher**

`electron/main/watcher.ts`:

```ts
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
```

> 抑制判断用**磁盘上的 size + mtime**与 `doc:write` 返回的凭证比对；命中即不发事件，渲染进程自然不会弹「外部修改」。`awaitWriteFinish` 保证原子替换只触发一次事件。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm test -- electron/main/watcher.test.ts`

Expected: PASS（6 个用例，其中集成用例在 Windows 上约 1–2s）。

- [x] **Step 5: 提交**

```bash
git add electron/main/watcher.ts electron/main/watcher.test.ts
git commit -m "feat(main): watch the open file and suppress self writes"
```

---

### Task 5: IPC 接线 + 渲染进程 IPC 封装 + MdDocument（TDD）

**Files:**

- Modify: `electron/shared/channels.ts`、`electron/main/index.ts`、`electron/preload/index.ts`
- Create: `electron/main/ipc.ts`
- Create: `packages/app/src/ipc.ts`、`packages/app/src/base64.ts`、`packages/app/src/base64.test.ts`、`packages/app/src/document/MdDocument.ts`、`packages/app/src/document/MdDocument.test.ts`、`packages/app/src/state/appStore.ts`

**Interfaces:**

- Consumes: Task 3 的 `readFile` / `writeAtomic`，Task 4 的 `createFileWatcher`
- Produces:
  - 通道：`docRead: 'doc:read'`、`docWrite: 'doc:write'`、`watchFile: 'watch:file'`、`externalModified: 'fs:external-modified'`
  - `window.mdEditor.readFile(path)` / `writeFile(path, bytesBase64)` / `watchFile(path)` / `onExternalModified(handler) => unsubscribe`
  - `MdDocument`（`bytesForSave(): string | null`，未编辑返回 `null`）
  - `useAppStore`（`doc` / `mode` / `externalNotice`）

- [x] **Step 1: 写 base64 与 MdDocument 失败测试**

`packages/app/src/base64.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decodeUtf8Base64, encodeUtf8Base64 } from './base64'

describe('base64 helpers', () => {
  it('round-trips ascii, CJK and emoji', () => {
    const text = '中文标题 🎉\n\n第二段\n'
    expect(decodeUtf8Base64(encodeUtf8Base64(text))).toBe(text)
  })

  it('round-trips crlf and empty input', () => {
    expect(decodeUtf8Base64(encodeUtf8Base64('a\r\nb\r\n'))).toBe('a\r\nb\r\n')
    expect(decodeUtf8Base64(encodeUtf8Base64(''))).toBe('')
  })
})
```

`packages/app/src/document/MdDocument.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { encodeUtf8Base64 } from '../base64'
import { MdDocument } from './MdDocument'

function createDoc(text: string) {
  return new MdDocument({
    id: 'doc-1',
    path: 'C:/notes/doc.md',
    text,
    originalBytesBase64: encodeUtf8Base64(text),
    eol: 'lf',
    hasBom: false,
  })
}

describe('MdDocument', () => {
  it('starts clean and exposes the buffer text', () => {
    const doc = createDoc('# hello\n')
    expect(doc.isDirty).toBe(false)
    expect(doc.text).toBe('# hello\n')
  })

  it('returns null from bytesForSave while untouched (零编辑不写盘)', () => {
    expect(createDoc('# hello\n').bytesForSave()).toBeNull()
  })

  it('becomes dirty when the editor converges back into the buffer', () => {
    const doc = createDoc('# hello\n')
    doc.applyEditorMarkdown('# hello world\n')
    expect(doc.isDirty).toBe(true)
    expect(doc.text).toBe('# hello world\n')
    expect(doc.bytesForSave()).toBe(encodeUtf8Base64('# hello world\n'))
  })

  it('stays clean when the editor reports identical markdown', () => {
    const doc = createDoc('# hello\n')
    doc.applyEditorMarkdown('# hello\n')
    expect(doc.isDirty).toBe(false)
  })

  it('supports range replacement for find-replace semantics', () => {
    const doc = createDoc('abc def\n')
    doc.replaceText({ from: 0, to: 3 }, 'xyz')
    expect(doc.text).toBe('xyz def\n')
    expect(doc.isDirty).toBe(true)
  })

  it('clears dirty state after a successful save', () => {
    const doc = createDoc('a\n')
    doc.applyEditorMarkdown('b\n')
    doc.markSaved()
    expect(doc.isDirty).toBe(false)
    expect(doc.bytesForSave()).toBeNull()
  })

  it('adopts external content and resets dirty state', () => {
    const doc = createDoc('old\n')
    doc.applyEditorMarkdown('mine\n')
    doc.setExternalText('external\n', encodeUtf8Base64('external\n'))
    expect(doc.text).toBe('external\n')
    expect(doc.isDirty).toBe(false)
    expect(doc.bytesForSave()).toBeNull()
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm test -- packages/app/src`

Expected: FAIL —— `./base64` 与 `./MdDocument` 不存在。

- [x] **Step 3: 实现 base64 与 MdDocument**

`packages/app/src/base64.ts`:

```ts
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeUtf8Base64(text: string): string {
  const bytes = encoder.encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function decodeUtf8Base64(base64: string): string {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return decoder.decode(bytes)
}
```

`packages/app/src/document/MdDocument.ts`:

```ts
import { encodeUtf8Base64 } from '../base64'
import type { WriteCredential } from '../bridge'

export interface MdDocumentInit {
  id: string
  path: string | null
  text: string
  originalBytesBase64: string
  eol: 'lf' | 'crlf'
  hasBom: boolean
}

export interface TextRange {
  from: number
  to: number
}

/**
 * Markdown Buffer 的唯一事实源。
 * PM Doc / CodeMirror Doc 都是它的投影，任何修改最终必须落到 text。
 */
export class MdDocument {
  private currentText: string
  private originalBytes: string
  private dirty = false
  private lastCredential: WriteCredential | null = null

  constructor(private readonly init: MdDocumentInit) {
    this.currentText = init.text
    this.originalBytes = init.originalBytesBase64
  }

  get id(): string {
    return this.init.id
  }

  get path(): string | null {
    return this.init.path
  }

  get eol(): 'lf' | 'crlf' {
    return this.init.eol
  }

  get hasBom(): boolean {
    return this.init.hasBom
  }

  get text(): string {
    return this.currentText
  }

  get isDirty(): boolean {
    return this.dirty
  }

  get credential(): WriteCredential | null {
    return this.lastCredential
  }

  /** 渲染模式键入防抖收敛：PM Doc -> Markdown -> Buffer。 */
  applyEditorMarkdown(markdown: string): void {
    if (markdown === this.currentText) return
    this.currentText = markdown
    this.dirty = true
  }

  /** 查找替换等操作直接改 Buffer。 */
  replaceText(range: TextRange, replacement: string): void {
    const next =
      this.currentText.slice(0, range.from) + replacement + this.currentText.slice(range.to)
    if (next === this.currentText) return
    this.currentText = next
    this.dirty = true
  }

  /**
   * 未编辑时返回 null —— 调用方必须据此跳过写盘，
   * 这正是「零编辑保存 = 不写盘」这条铁律的实现方式。
   */
  bytesForSave(): string | null {
    if (!this.dirty) return null
    return encodeUtf8Base64(this.currentText)
  }

  markSaved(credential: WriteCredential | null = null): void {
    if (this.dirty) {
      this.originalBytes = encodeUtf8Base64(this.currentText)
    }
    this.dirty = false
    this.lastCredential = credential
  }

  /** 外部修改且 Buffer 干净时的自动重载路径。 */
  setExternalText(text: string, originalBytesBase64: string): void {
    this.currentText = text
    this.originalBytes = originalBytesBase64
    this.dirty = false
  }
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm test -- packages/app/src`

Expected: PASS（9 个用例）。

- [x] **Step 5: 补 IPC 通道、主进程 handler 与 preload 方法**

`electron/shared/channels.ts` 改为：

```ts
export const CHANNELS = {
  appInfo: 'app:info',
  docRead: 'doc:read',
  docWrite: 'doc:write',
  watchFile: 'watch:file',
  externalModified: 'fs:external-modified',
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]
```

`electron/main/ipc.ts`:

```ts
import { ipcMain, type BrowserWindow } from 'electron'
import type { FSWatcher } from 'chokidar'
import { CHANNELS } from '../shared/channels'
import { readFile, writeAtomic, type WriteCredential } from './fs_io'
import { createFileWatcher } from './watcher'

export interface IpcRegistry {
  dispose(): Promise<void>
}

export function registerIpc(getWindow: () => BrowserWindow | null): IpcRegistry {
  let credential: WriteCredential | null = null
  let watcher: FSWatcher | null = null

  ipcMain.handle(CHANNELS.docRead, (_event, path: string) => readFile(path))

  ipcMain.handle(CHANNELS.docWrite, async (_event, path: string, bytesBase64: string) => {
    credential = await writeAtomic(path, Buffer.from(bytesBase64, 'base64'))
    return credential
  })

  ipcMain.handle(CHANNELS.watchFile, async (_event, path: string) => {
    await watcher?.close()
    watcher = await createFileWatcher({
      path,
      getCredential: () => credential,
      onChange: (changed) => getWindow()?.webContents.send(CHANNELS.externalModified, changed),
    })
  })

  return {
    async dispose() {
      await watcher?.close()
      ipcMain.removeHandler(CHANNELS.docRead)
      ipcMain.removeHandler(CHANNELS.docWrite)
      ipcMain.removeHandler(CHANNELS.watchFile)
    },
  }
}
```

`electron/main/index.ts`：删掉 Task 2 里的本地 `registerIpc()`，改为：

```ts
import { registerIpc, type IpcRegistry } from './ipc'

let ipcRegistry: IpcRegistry | null = null

// app.whenReady() 内：
ipcRegistry = registerIpc(() => mainWindow)

// 顶层新增：
app.on('before-quit', () => {
  void ipcRegistry?.dispose()
})
```

`electron/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '../shared/channels'

export interface AppInfo {
  version: string
  electron: string
}

export interface FileContent {
  base64: string
  text: string
  eol: 'lf' | 'crlf'
  hasBom: boolean
}

export interface WriteCredential {
  path: string
  size: number
  mtimeMs: number
  writtenAtMs: number
}

export interface MdEditorBridge {
  getAppInfo(): Promise<AppInfo>
  readFile(path: string): Promise<FileContent>
  writeFile(path: string, bytesBase64: string): Promise<WriteCredential>
  watchFile(path: string): Promise<void>
  onExternalModified(handler: (path: string) => void): () => void
}

const bridge: MdEditorBridge = {
  getAppInfo: () => ipcRenderer.invoke(CHANNELS.appInfo) as Promise<AppInfo>,
  readFile: (path) => ipcRenderer.invoke(CHANNELS.docRead, path) as Promise<FileContent>,
  writeFile: (path, bytesBase64) =>
    ipcRenderer.invoke(CHANNELS.docWrite, path, bytesBase64) as Promise<WriteCredential>,
  watchFile: (path) => ipcRenderer.invoke(CHANNELS.watchFile, path) as Promise<void>,
  onExternalModified: (handler) => {
    const listener = (_event: unknown, changed: string): void => handler(changed)
    ipcRenderer.on(CHANNELS.externalModified, listener)
    return () => {
      ipcRenderer.removeListener(CHANNELS.externalModified, listener)
    }
  },
}

contextBridge.exposeInMainWorld('mdEditor', bridge)
```

`packages/app/src/bridge.d.ts`：补上 `FileContent` / `WriteCredential` 与四个新方法（字段名必须与 preload 完全一致）。

- [x] **Step 6: 写渲染进程 IPC 封装与 store**

`packages/app/src/ipc.ts`:

```ts
import type { FileContent, MdEditorBridge, WriteCredential } from './bridge'

export interface Ipc {
  readFile(path: string): Promise<FileContent>
  writeFile(path: string, bytesBase64: string): Promise<WriteCredential>
  watchFile(path: string): Promise<void>
  onExternalModified(handler: (path: string) => void): () => void
}

export function createIpc(bridge: MdEditorBridge): Ipc {
  return {
    readFile: (path) => bridge.readFile(path),
    writeFile: (path, bytes) => bridge.writeFile(path, bytes),
    watchFile: (path) => bridge.watchFile(path),
    onExternalModified: (handler) => bridge.onExternalModified(handler),
  }
}

export const ipc: Ipc = createIpc(window.mdEditor)
```

`packages/app/src/state/appStore.ts`:

```ts
import { create } from 'zustand'
import type { MdDocument } from '../document/MdDocument'

export type EditorMode = 'wysiwyg' | 'source'

export interface AppState {
  doc: MdDocument | null
  mode: EditorMode
  externalNotice: string | null
  setDoc(doc: MdDocument | null): void
  setMode(mode: EditorMode): void
  setExternalNotice(notice: string | null): void
}

export const useAppStore = create<AppState>((set) => ({
  doc: null,
  mode: 'wysiwyg',
  externalNotice: null,
  setDoc: (doc) => set({ doc }),
  setMode: (mode) => set({ mode }),
  setExternalNotice: (externalNotice) => set({ externalNotice }),
}))
```

- [x] **Step 7: 全量测试与类型检查**

Run: `pnpm test; pnpm typecheck`

Expected: 全部通过（fs_io 5 + watcher 6 + security 3 + base64 2 + MdDocument 7 = 23 个用例）。

- [x] **Step 8: 提交**

```bash
git add electron packages/app
git commit -m "feat(app): wire ipc bridge and buffer-of-truth document"
```

---

### Task 6: editor 包 —— 防抖收敛（TDD） + Milkdown `EditorHost`

**Files:**

- Create: `packages/editor/package.json`、`packages/editor/tsconfig.json`、`packages/editor/src/sync.ts`、`packages/editor/src/sync.test.ts`、`packages/editor/src/EditorHost.tsx`、`packages/editor/src/index.ts`
- Modify: `packages/app/package.json`（加入 `@md-editor/editor` 依赖）、根 `package.json`（`typecheck` 覆盖 editor 包）

**Interfaces:**

- Consumes: `@milkdown/kit` 7.22.3、`@milkdown/react` 7.22.3
- Produces:
  - `createMarkdownSync({ delayMs?, serialize, onFlush }): { schedule(); flushNow(); dispose(); pending }`
  - `interface EditorHandle { getMarkdown(): string; flushNow(): void }`
  - `<EditorHost docId initialMarkdown onMarkdownChange onReady />`

- [x] **Step 1: 写 sync 失败测试**

`packages/editor/src/sync.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownSync } from './sync'

describe('createMarkdownSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes once after the debounce window', () => {
    const onFlush = vi.fn()
    const sync = createMarkdownSync({ delayMs: 300, serialize: () => '# md', onFlush })

    sync.schedule()
    sync.schedule()
    sync.schedule()
    vi.advanceTimersByTime(299)
    expect(onFlush).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith('# md')
    expect(sync.pending).toBe(false)
  })

  it('flushNow writes immediately and does not fire again later', () => {
    const onFlush = vi.fn()
    const sync = createMarkdownSync({ delayMs: 300, serialize: () => 'body', onFlush })

    sync.schedule()
    sync.flushNow()

    expect(onFlush).toHaveBeenCalledWith('body')
    vi.advanceTimersByTime(1000)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('does nothing when flushed without pending changes', () => {
    const onFlush = vi.fn()
    const sync = createMarkdownSync({ serialize: () => 'x', onFlush })

    sync.flushNow()
    vi.advanceTimersByTime(1000)

    expect(onFlush).not.toHaveBeenCalled()
  })

  it('dispose cancels a pending flush', () => {
    const onFlush = vi.fn()
    const sync = createMarkdownSync({ delayMs: 300, serialize: () => 'x', onFlush })

    sync.schedule()
    sync.dispose()
    vi.advanceTimersByTime(1000)

    expect(onFlush).not.toHaveBeenCalled()
    expect(sync.pending).toBe(false)
  })

  it('serializes at flush time, not at schedule time', () => {
    let markdown = 'first'
    const onFlush = vi.fn()
    const sync = createMarkdownSync({ delayMs: 300, serialize: () => markdown, onFlush })

    sync.schedule()
    markdown = 'second'
    vi.advanceTimersByTime(300)

    expect(onFlush).toHaveBeenCalledWith('second')
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm test -- packages/editor/src/sync.test.ts`

Expected: FAIL —— `./sync` 不存在。

- [x] **Step 3: 实现 sync**

`packages/editor/src/sync.ts`:

```ts
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
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm test -- packages/editor/src/sync.test.ts`

Expected: PASS（5 个用例）。

- [x] **Step 5: 写 Milkdown `EditorHost`**

`packages/editor/package.json`:

```json
{
  "name": "@md-editor/editor",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "@milkdown/kit": "7.22.3",
    "@milkdown/react": "7.22.3",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "typescript": "5.9.3",
    "vitest": "5.0.4"
  }
}
```

`packages/editor/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src"]
}
```

`packages/editor/src/EditorHost.tsx`:

```tsx
import { defaultValueCtx, Editor, rootCtx } from '@milkdown/kit/core'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { getMarkdown } from '@milkdown/kit/utils'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { useEffect, useMemo, useRef } from 'react'
import { createMarkdownSync } from './sync'

export interface EditorHandle {
  getMarkdown(): string
  flushNow(): void
}

export interface EditorHostProps {
  docId: string
  initialMarkdown: string
  onMarkdownChange(markdown: string): void
  onReady?(handle: EditorHandle): void
}

function EditorHostInner(props: EditorHostProps) {
  const { docId, initialMarkdown, onMarkdownChange, onReady } = props
  const handleRef = useRef<EditorHandle | null>(null)

  const sync = useMemo(
    () =>
      createMarkdownSync({
        delayMs: 300,
        serialize: () => handleRef.current?.getMarkdown() ?? initialMarkdown,
        onFlush: (markdown) => onMarkdownChange(markdown),
      }),
    [initialMarkdown, onMarkdownChange],
  )

  useEffect(() => () => sync.dispose(), [sync])

  const { get } = useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, initialMarkdown)
          ctx.get(listenerCtx).markdownUpdated(() => {
            sync.schedule()
          })
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(listener),
    [docId],
  )

  useEffect(() => {
    const handle: EditorHandle = {
      getMarkdown: () => {
        const editor = get()
        return editor ? editor.action(getMarkdown()) : initialMarkdown
      },
      flushNow: () => sync.flushNow(),
    }
    handleRef.current = handle
    onReady?.(handle)
  }, [get, initialMarkdown, onReady, sync])

  return <Milkdown />
}

export function EditorHost(props: EditorHostProps) {
  return (
    <MilkdownProvider>
      <EditorHostInner {...props} />
    </MilkdownProvider>
  )
}
```

`packages/editor/src/index.ts`:

```ts
export { EditorHost, type EditorHandle, type EditorHostProps } from './EditorHost'
export { createMarkdownSync, type MarkdownSync, type MarkdownSyncOptions } from './sync'
```

> 已核实的 Milkdown 7.22.3 API：`useEditor` 返回 `{ loading, get }`；`editor.action(getMarkdown())` 取 Markdown；`listenerCtx.markdownUpdated` 提供变更通知；`history` 是 `MilkdownPlugin[]`。

- [x] **Step 6: 接入 app 依赖并全量校验**

1. `packages/app/package.json` 的 `dependencies` 增加 `"@md-editor/editor": "workspace:*"`。
2. 根 `package.json` 的 `typecheck` 改为：

```json
"typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p packages/editor/tsconfig.json && tsc --noEmit -p packages/app/tsconfig.json"
```

Run: `pnpm install; pnpm test; pnpm typecheck`

Expected: 28 个用例通过，类型检查无错误。

- [x] **Step 7: 提交**

```bash
git add packages/editor packages/app/package.json package.json pnpm-lock.yaml
git commit -m "feat(editor): add debounced sync and milkdown host"
```

---

### Task 7: 打开 / 编辑 / 保存闭环 + 零编辑不写盘（e2e）

**Files:**

- Modify: `electron/main/index.ts`（支持 `--open <path>`）、`packages/app/src/App.tsx`（改为完整编排）、`packages/app/src/app.css`
- Create: `e2e/fixtures/sample.md`、`e2e/open-save.spec.ts`

**Interfaces:**

- Consumes: Task 5 的 `ipc` 与 `MdDocument`、Task 6 的 `EditorHost`
- Produces: `--open <path>` 启动参数（M5 文件关联的基础）；`Ctrl+S` 保存语义（未编辑则跳过写盘）

- [x] **Step 1: 写失败的 e2e**

`e2e/fixtures/sample.md`:

```markdown
# Title

- item one
- item two
```

`e2e/open-save.spec.ts`:

```ts
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
}

async function withFixture<T>(run: (file: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-doc-'))
  const file = join(dir, 'sample.md')
  writeFileSync(file, readFileSync(join(__dirname, 'fixtures/sample.md')))
  return run(file)
}

test('renders the opened markdown file', async () => {
  await withFixture(async (file) => {
    const app = await launchApp(file)
    const window = await app.firstWindow()
    await expect(window.locator('.ProseMirror')).toContainText('Title')
    await app.close()
  })
})

test('saves typed content on ctrl+s', async () => {
  await withFixture(async (file) => {
    const app = await launchApp(file)
    const window = await app.firstWindow()
    const editor = window.locator('.ProseMirror')
    await editor.click()
    await window.keyboard.press('Control+End')
    await window.keyboard.type('typed')
    await window.waitForTimeout(500)
    await window.keyboard.press('Control+s')
    await expect(window.locator('[data-testid="status"]')).toContainText('已保存')

    expect(readFileSync(file, 'utf8')).toContain('typed')
    await app.close()
  })
})

test('does not touch the file when nothing was edited', async () => {
  await withFixture(async (file) => {
    const before = statSync(file)
    const app = await launchApp(file)
    const window = await app.firstWindow()
    await expect(window.locator('.ProseMirror')).toContainText('Title')

    await window.keyboard.press('Control+s')
    await window.waitForTimeout(400)

    const after = statSync(file)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.size).toBe(before.size)
    await app.close()
  })
})
```

- [x] **Step 2: 运行确认失败**

Run: `pnpm e2e -- e2e/open-save.spec.ts`

Expected: FAIL —— 主进程尚未处理 `--open`，编辑器未挂载。

- [x] **Step 3: 主进程支持 `--open`**

在 `electron/main/index.ts` 增加参数解析与转发：

```ts
function openPathFromCli(): string | null {
  const index = process.argv.indexOf('--open')
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

// app.whenReady() 内、createMainWindow() 之后：
const cliPath = openPathFromCli()
if (cliPath !== null) {
  mainWindow?.webContents.once('did-finish-load', () => {
    mainWindow?.webContents.send(CHANNELS.openFile, cliPath)
  })
}
```

`electron/shared/channels.ts` 追加 `openFile: 'app:open-file'`；`electron/preload/index.ts` 追加与 `onExternalModified` 同构的：

```ts
onOpenFile(handler: (path: string) => void): () => void
```

`packages/app/src/bridge.d.ts` 与 `packages/app/src/ipc.ts` 同步补上 `onOpenFile`。

- [x] **Step 4: 写 App 编排**

`packages/app/src/App.tsx`:

```tsx
import { EditorHost, type EditorHandle } from '@md-editor/editor'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MdDocument } from './document/MdDocument'
import { ipc } from './ipc'
import { useAppStore } from './state/appStore'

export function App() {
  const doc = useAppStore((state) => state.doc)
  const setDoc = useAppStore((state) => state.setDoc)
  const externalNotice = useAppStore((state) => state.externalNotice)
  const setExternalNotice = useAppStore((state) => state.setExternalNotice)
  const [status, setStatus] = useState('未打开文件')
  const [reloadToken, setReloadToken] = useState(0)
  const editorHandle = useRef<EditorHandle | null>(null)

  const openFile = useCallback(
    async (path: string) => {
      const content = await ipc.readFile(path)
      await ipc.watchFile(path)
      setDoc(
        new MdDocument({
          id: `${path}#${Date.now()}`,
          path,
          text: content.text,
          originalBytesBase64: content.base64,
          eol: content.eol,
          hasBom: content.hasBom,
        }),
      )
      setExternalNotice(null)
      setStatus(`已打开 ${path}`)
      setReloadToken((token) => token + 1)
    },
    [setDoc, setExternalNotice],
  )

  const save = useCallback(async () => {
    const current = useAppStore.getState().doc
    if (current === null || current.path === null) return
    editorHandle.current?.flushNow()
    const bytes = current.bytesForSave()
    if (bytes === null) {
      setStatus('无改动，已跳过写盘')
      return
    }
    const credential = await ipc.writeFile(current.path, bytes)
    current.markSaved(credential)
    setStatus('已保存')
  }, [])

  useEffect(() => {
    const unsubscribe = ipc.onOpenFile((path) => {
      void openFile(path)
    })
    return unsubscribe
  }, [openFile])

  useEffect(() => {
    const unsubscribe = ipc.onExternalModified(async (path) => {
      const current = useAppStore.getState().doc
      if (current === null || current.path !== path) return
      if (current.isDirty) {
        setExternalNotice('文件已被外部修改，请另存以免覆盖')
        return
      }
      const content = await ipc.readFile(path)
      current.setExternalText(content.text, content.base64)
      setReloadToken((token) => token + 1)
      setExternalNotice(null)
      setStatus('已自动重载外部修改')
    })
    return unsubscribe
  }, [setExternalNotice])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save])

  return (
    <main className="workspace">
      <header className="chrome">
        <span data-testid="status">
          {doc?.isDirty === true ? '未保存 · ' : ''}
          {status}
        </span>
      </header>
      {externalNotice !== null ? <p className="notice">{externalNotice}</p> : null}
      <section className="editor-host">
        {doc === null ? (
          <p className="placeholder">正在等待文件…</p>
        ) : (
          <EditorHost
            key={`${doc.id}-${reloadToken}`}
            docId={doc.id}
            initialMarkdown={doc.text}
            onMarkdownChange={(markdown) => doc.applyEditorMarkdown(markdown)}
            onReady={(handle) => {
              editorHandle.current = handle
            }}
          />
        )}
      </section>
    </main>
  )
}
```

`packages/app/src/app.css` 追加：

```css
.workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chrome {
  padding: 8px 16px;
  border-bottom: 1px solid #d0d7de;
  color: #57606a;
  font-size: 0.875rem;
}

.notice {
  margin: 0;
  padding: 8px 16px;
  border-bottom: 1px solid #d0d7de;
  color: #57606a;
}

.editor-host {
  flex: 1;
  padding: 0 96px;
  overflow-y: auto;
}

.milkdown .ProseMirror {
  min-height: 60vh;
  outline: none;
  line-height: 1.7;
}
```

- [x] **Step 5: 运行 e2e 确认通过**

Run: `pnpm e2e -- e2e/open-save.spec.ts`

Expected: PASS（3 个用例）。第三个用例断言 mtime 与 size 均不变，证明**零编辑保存完全没有写盘**。

- [x] **Step 6: 提交**

```bash
git add electron packages/app e2e
git commit -m "feat(app): open, edit and save markdown with no-op save"
```

---

### Task 8: 外部修改自动重载 + 自身写入不误报（e2e）

**Files:**

- Create: `e2e/external-change.spec.ts`

**Interfaces:**

- Consumes: Task 4 的 watcher、Task 7 的 App 编排
- Produces: R4 的可执行证据（自动重载 / 无误报）

- [x] **Step 1: 写 e2e**

`e2e/external-change.spec.ts`:

```ts
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

async function withFixture<T>(run: (file: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-ext-'))
  const file = join(dir, 'sample.md')
  writeFileSync(file, readFileSync(join(__dirname, 'fixtures/sample.md')))
  return run(file)
}

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
}

test('reloads the editor when the file is changed externally', async () => {
  await withFixture(async (file) => {
    const app = await launchApp(file)
    const window = await app.firstWindow()
    await expect(window.locator('.ProseMirror')).toContainText('Title')

    writeFileSync(file, '# Replaced\n\nexternal body\n')

    await expect(window.locator('.ProseMirror')).toContainText('Replaced', { timeout: 10_000 })
    await expect(window.locator('.notice')).toHaveCount(0)
    await app.close()
  })
})

test('does not warn about external changes for our own save', async () => {
  await withFixture(async (file) => {
    const app = await launchApp(file)
    const window = await app.firstWindow()
    await window.locator('.ProseMirror').click()
    await window.keyboard.press('Control+End')
    await window.keyboard.type(' local edit')
    await window.waitForTimeout(500)
    await window.keyboard.press('Control+s')

    await window.waitForTimeout(800)
    await expect(window.locator('.notice')).toHaveCount(0)
    expect(readFileSync(file, 'utf8')).toContain('local edit')
    await app.close()
  })
})
```

- [x] **Step 2: 运行并修产品代码（不改断言）**

Run: `pnpm e2e -- e2e/external-change.spec.ts`

Expected: 2 个用例 PASS。若第一个超时，检查 `electron/main/ipc.ts` 是否把 watcher 存进闭包变量（被 GC 掉会导致监听静默失效）。

- [x] **Step 3: 提交**

```bash
git add e2e/external-change.spec.ts
git commit -m "test(e2e): cover external change reload and self-write suppression"
```

---

### Task 9: 性能基线实测 + `printToPDF` 冒烟

**Files:**

- Modify: `electron/main/index.ts`（启动打点、`--probe-memory <file>`）、根 `package.json`（新增 `"measure": "node scripts/measure-startup.mjs"`）
- Create: `scripts/measure-startup.mjs`、`e2e/print-pdf.spec.ts`

**Interfaces:**

- Consumes: Task 7 的 `--open`
- Produces: `development.md` 7 节的一行真实基线；ADR-4 的冒烟证据

- [x] **Step 1: 主进程打点**

`electron/main/index.ts` 增加（`writeFileSync` 从 `node:fs` 引入）：

```ts
const STARTED_AT = Date.now()

function probeMemoryPathFromCli(): string | null {
  const index = process.argv.indexOf('--probe-memory')
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

// createMainWindow() 之后：
mainWindow?.once('ready-to-show', () => {
  console.log(`[startup] ready ${Date.now() - STARTED_AT}`)
  const probePath = probeMemoryPathFromCli()
  if (probePath !== null) {
    writeFileSync(probePath, JSON.stringify(app.getAppMetrics(), null, 2))
    app.quit()
  }
})
```

- [x] **Step 2: 写测量脚本**

`scripts/measure-startup.mjs`:

```js
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
      { env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-m-')) } },
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
```

- [x] **Step 3: 运行测量并记录**

Run: `pnpm build:app; pnpm measure`

Expected: 输出一行 Markdown 表格数据；把该行抄进 `development.md` 7 节（替换"待 M0"占位行）。

> **口径提醒**：`app.getAppMetrics()` 只暴露 `workingSetSize`（KB），**拿不到**文档口径里的"私有工作集"。M0 先记该值并写明工具差异；若明显超标，按 `architecture.md` 5 节约定找用户裁定，不得自行放宽数字。

- [x] **Step 4: 写 `printToPDF` 冒烟**

`e2e/print-pdf.spec.ts`:

```ts
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('prints the rendered document to a silent pdf', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-pdf-'))
  const file = join(dir, 'sample.md')
  const pdf = join(dir, 'out.pdf')
  writeFileSync(file, '# PDF smoke\n\ncontent\n')

  const app = await electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
  const window = await app.firstWindow()
  await expect(window.locator('.ProseMirror')).toContainText('PDF smoke')

  await app.evaluate(async ({ BrowserWindow }, target) => {
    const [targetWindow] = BrowserWindow.getAllWindows()
    const data = await targetWindow.webContents.printToPDF({ printBackground: true })
    require('node:fs').writeFileSync(target, data)
  }, pdf)

  const bytes = readFileSync(pdf)
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF')
  expect(bytes.length).toBeGreaterThan(1000)

  await app.close()
})
```

- [x] **Step 5: 运行冒烟并提交**

Run: `pnpm e2e -- e2e/print-pdf.spec.ts`

Expected: PASS —— 静默产出合法 PDF，证明 ADR-4 成立（不需要 headless Chromium）。

```bash
git add electron/main/index.ts scripts e2e/print-pdf.spec.ts package.json
git commit -m "chore(perf): measure startup baseline and smoke print-to-pdf"
```

---

### Task 10: 质量门禁与 CI

**Files:**

- Create: `eslint.config.mjs`、`.github/workflows/ci.yml`

**Interfaces:**

- Consumes: Task 1 的根脚本
- Produces: PR 必过的两个 job（`check` / `build`），其中 `check` 同时覆盖 R7 安全断言

- [x] **Step 1: 写 ESLint flat config**

`eslint.config.mjs`:

```js
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', 'out/**', 'release/**', 'coverage/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['electron/**/*.ts', 'packages/**/*.{ts,tsx}', 'e2e/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
)
```

- [x] **Step 2: 跑 lint 并修真实问题**

Run: `pnpm lint`

Expected: 通过（Prettier 报格式差异就 `pnpm format` 后重跑；报 `any` 就改代码，不许关规则）。

- [x] **Step 3: 写 CI**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.25.0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: xvfb-run -a pnpm e2e

  build:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.25.0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build:app
      - run: pnpm exec electron-builder --dir
```

> `check` 在 Ubuntu 上用 `xvfb-run` 跑 Electron e2e（CI 无显示器）；`build` 只做打包干跑（`--dir`），安装包与签名属 M5。

- [x] **Step 4: 本地复现门禁**

Run: `pnpm typecheck; pnpm lint; pnpm test; pnpm e2e`

Expected: 全绿；e2e 共 7 个用例（shell 1 + open-save 3 + external-change 2 + print-pdf 1）。

- [x] **Step 5: 提交**

```bash
git add eslint.config.mjs .github/workflows/ci.yml
git commit -m "chore(ci): add electron lint, test and build gates"
```

---

### Task 11: 文档收口（把实测数字写回权威文档）

**Files:**

- Modify: `development.md`（7 节性能记录、`e2e:install` 说明）、`TODO.md`（M0 勾选与验收记录）、`component-api.md`（若 API 有漂移）

**Interfaces:**

- Consumes: Task 1–10 的全部产出
- Produces: 与实现一致的 M0 状态

- [x] **Step 1: 写入性能基线**

把 Task 9 输出的一行数据替换 `development.md` 7 节里的"待 M0"占位行，并在备注写明：测量工具（`app.getAppMetrics()`）、口径差异（`workingSetSize` 之和 vs `architecture.md` 5 节的"私有工作集"）、平台（win32）。

- [x] **Step 2: 澄清 `e2e:install`**

`development.md` 1 节表格里 Playwright 一行改为：

```markdown
| Playwright | 跟随 devDependencies | e2e 走 `_electron` 驱动真实应用，**不需要** `pnpm e2e:install`；该命令仅供将来浏览器模式用例使用 |
```

- [x] **Step 3: 校对 `component-api.md`**

逐项核对实现与文档：通道名（`app:info` / `doc:read` / `doc:write` / `watch:file` / `app:open-file` / `fs:external-modified`）、`MdDocument.bytesForSave(): string | null`、`EditorHandle`、`createMarkdownSync`。**只允许把文档改成实现的样子，或把实现改成文档的样子，不允许两边各写一套。**

- [x] **Step 4: 勾选 TODO 并记录验收**

勾选 `TODO.md` M0 全部条目，并在验收行追加：

```markdown
（M0 验收记录：`pnpm e2e` 全绿——打开/编辑/保存 3 例、外部修改 2 例、PDF 冒烟 1 例、Shell 1 例；零编辑保存 mtime 与 size 均未变化；性能基线已记入 development.md 7 节）
```

- [x] **Step 5: 全量终检**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm e2e
pnpm build:app
```

Expected: 全部通过；`pnpm e2e` 7 个用例全绿。

- [x] **Step 6: 提交并打标签**

```bash
git add development.md TODO.md component-api.md
git commit -m "docs: close out M0 electron skeleton milestone"
git tag m0-electron
```

---

## Self-Review

**1. Spec coverage（逐条对照 `TODO.md` M0）**

| M0 条目                                                                          | 覆盖任务                                                   |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 初始化 pnpm monorepo：`electron/{main,preload,shared}` + `packages/{app,editor}` | Task 1、2、6（`export` / `theming` 见偏离表第 4 条）       |
| Electron + Vite + React 18 + TS 骨架可运行，`pnpm dev` 打开空窗口                | Task 2                                                     |
| preload 契约 + 主进程 `fs_io`（原子写 + 写入凭证）                               | Task 3、5                                                  |
| 打开 .md → 编辑 → 保存（Ctrl+S）；零编辑保存不写盘                               | Task 7                                                     |
| 性能基线实测（包体 / 冷启动 / 空文档内存）并写入 `development.md` 7 节           | Task 9、11                                                 |
| chokidar 单文件监听 + 写入凭证抑制自身事件                                       | Task 4、8                                                  |
| ESLint + Prettier + Electron 安全基线断言（R7）                                  | Task 2（`buildCsp` 单测 + e2e 无 `require` 断言）、Task 10 |
| Vitest + Playwright 基础配置（含 `_electron` 启动冒烟）                          | Task 2、10、11                                             |
| CI：Windows 构建 + 三平台 `electron-builder` 干跑                                | Task 10                                                    |
| 验收：打开/编辑/保存 + 外部修改后正确重渲染                                      | Task 7、8、11                                              |

**2. Placeholder scan**

- 正文无 `TBD` /「稍后实现」/「类似 Task N」之类含糊占位。
- `scripts/theme-check.mjs` 是**显式失败**的占位（`exit 1` + 提示「M4 交付」），不会让 CI 误判为通过——这是刻意的，不是含糊占位。
- Task 9 输出里的 `<commit>` 由实现者在提交时替换为真实短哈希。

**3. Type consistency（跨任务签名核对）**

- `WriteCredential`：Task 3 定义为 `{ path, size, mtimeMs, writtenAtMs }`；Task 4 的 `shouldSuppress`、Task 5 的 IPC 返回值、Task 7 的 `markSaved(credential)` 全部一致。
- `FileContent`：Task 3 定义为 `{ base64, text, eol, hasBom }`；Task 5 的 preload 与 `bridge.d.ts` 字段名一致（注意是 `hasBom`，不是 `hasBOM`）。
- `MdDocument.bytesForSave(): string | null`：Task 5 实现、Task 7 调用（`bytes === null` 分支跳过写盘）一致。
- `EditorHandle`：Task 6 定义 `{ getMarkdown(); flushNow() }`；Task 7 只使用 `flushNow()`（`getMarkdown` 由 sync 内部使用），一致。
- 通道常量：Task 5、7 均从 `CHANNELS` 取值，代码里禁止出现裸字符串。

**4. 已知偏离与登记**

| #   | 偏离                                                         | 说明                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 内存测量口径                                                 | `app.getAppMetrics()` 没有「私有工作集」，M0 记 `workingSetSize` 之和并在 `development.md` 7 节写明差异（Task 9 Step 3、Task 11 Step 1）                                                                                     |
| 2   | `cursor-map` 不在 M0                                         | M0 只保证 Buffer 是唯一事实源、Milkdown 视图可由 Buffer 重建；精确光标恢复属 M2 P0                                                                                                                                           |
| 3   | e2e 用 `--open` 而非系统对话框                               | 避免自动化驱动系统文件对话框；同时为 M5 文件关联打基础                                                                                                                                                                       |
| 4   | `packages/export` / `packages/theming` 在 M0 不创建          | `TODO.md` M0 只要求结构就位，这两个包的实现分别在 M4 导出与主题阶段；提前建空包属 YAGNI。若要求「目录必须齐」，在 Task 1 各加一个只含 `package.json` 的占位包并在此登记                                                      |
| 5   | 首次冷启动不设硬门禁                                         | 首次含系统扫描等一次性开销，`architecture.md` 5 节给了 < 8s 的宽松值；CI 不测启动时间，仅在实际发布前手工测（M5）                                                                                                            |
| 6   | `pnpm-workspace.yaml` 含 pnpm 11.25 自动写入的 `allowBuilds` | pnpm 11.25.0 会把 `electron-winstaller` 的构建脚本置为需批准并重写该文件；已裁决 `electron-winstaller: true`（该脚本仅选择随包 7-Zip 架构）。若未来改为 `false`，必须先验证 `electron-builder --dir` 与 Windows 打包仍可用。 |

**5. 执行顺序注意事项**

- 执行顺序：Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11；每个 Task 独立提交，便于逐任务 review 与回退。
- Task 2 的 e2e 需要先 `pnpm build:app`（根脚本 `e2e` 已内置），**不要**直接把 `playwright test` 当作入口。
- Task 6 才创建 `packages/editor`；Task 2 的 `packages/app/package.json` **不能**提前声明该依赖。
- Task 9 依赖 Task 7 的 `--open` 参数，必须排在 Task 7 之后。
- 本计划不含任何 Rust / MSVC / WSL 步骤；实现过程中若有人建议装 Rust，说明已偏离 2026-10-15 的架构评审结论，应当先改文档再动手。
