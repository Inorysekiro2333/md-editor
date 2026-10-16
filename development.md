# development.md — 开发方式、命令与回归清单

> **2026-10-15 架构评审**：桌面壳改为 Electron，**不再需要 Rust / MSVC / WSL / WebView2**；命令集与回归清单同步重写。

## 1. 环境要求

| 依赖       | 版本                 | 说明                                                                                             |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| Node.js    | >= 20 LTS            |                                                                                                  |
| pnpm       | >= 9                 | 包管理（`corepack enable` 可启用）                                                               |
| Electron   | 44.x                 | 作为 devDependency 安装，不需要全局安装                                                          |
| Playwright | 跟随 devDependencies | e2e 走 `_electron` 驱动真实应用，**不需要** `pnpm e2e:install`；该命令仅供将来浏览器模式用例使用 |

- 不再需要：Rust 工具链、MSVC 生成工具、WSL、WebView2 Runtime。
- 三平台开发均可本地 `pnpm dev`；本仓库当前只在 Windows 上做过手工验证，macOS / Linux 由 CI 覆盖（见 6 节 R5）。

## 2. 常用命令

```bash
pnpm install          # 安装全部依赖
pnpm dev              # 开发模式（Electron 主进程 + Vite HMR）
pnpm build            # 打包当前平台安装包（electron-builder；三平台在各自 CI 打包）
pnpm test             # Vitest 单元测试（watch: pnpm test:watch）
pnpm test:coverage    # 覆盖率报告（仅参考，不是门禁）
pnpm e2e              # Playwright（Electron 启动 + 浏览器两种模式）
pnpm lint             # ESLint + Prettier check（覆盖 electron/ 与 packages/）
pnpm theme:check      # 主题规范校验（M4 后可用）
```

- 已删除：`pnpm lint:rust`（无 Rust 代码）。
- 命令的权威定义在本节；其他文档不得自行发明命令。

## 3. Monorepo 结构

```
electron/
  main/               主进程：窗口 / 菜单 / fs_io / watcher / 导出 / 更新
  preload/            contextBridge 契约（渲染进程唯一通道）
  shared/             主进程与 preload 共用的类型与通道常量
packages/
  app/                React 工作台（渲染进程外壳）
  editor/             Milkdown 封装 + CodeMirror 源码模式 + cursor-map
  export/             导出管线（PDF 走 printToPDF、HTML 自包含）
  theming/            主题
e2e/                  Playwright 用例
docs/                 补充文档（当前 8 份核心文档位于仓库根目录；AGENTS/DESIGN/TODO 按约定必须留在根目录）
```

依赖方向只允许向下：`app → editor / export / theming`；`editor`、`export`、`theming` 之间互不依赖，且都不得依赖 `app`。

## 4. 编码约定

- TypeScript strict；禁止 `any`（确需用 `unknown` + 收窄）。
- 渲染进程不得访问 Node/fs；新增跨进程能力必须同时改 preload 白名单、主进程 handler、`component-api.md` 7 节 IPC 表。
- 主进程错误处理：结构化错误码 + 日志；禁止吞异常，禁止把内部路径/堆栈直接抛给渲染进程。
- Electron 安全基线（`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`）不得为了省事放宽；确需放宽必须在 `architecture.md` 2.3 记录理由。
- 提交信息：英文祈使句 + scope，如 `fix(editor): keep cursor when toggling source mode`。
- 分支：`feat/xxx`、`fix/xxx`；主分支 `main`，PR 必须 CI 全绿。
- 每个 PR 描述需包含：改了什么 / 为什么 / 如何验证（跑过哪些回归项）。

## 5. 新增一个 Markdown 节点类型的固定流程

1. 在 `packages/editor` 注册 Milkdown preset 或自定义 NodeView（渲染表现）。
2. 在 `packages/editor/src/roundtrip.test.ts` 登记用例：典型形态 + 边界形态 + 混合嵌套 + **已知规范化差异**。
3. 如有视觉表现：在 `DESIGN.md` 登记 token，在 `packages/theming` 提供默认值。
4. 手测 IME（见 6 节 R2）。

> 说明：mdast ↔ PM 的转换由 Milkdown 内置承担，我们不重复实现；因此这一节的重点是"注册 + 差异登记"，不是"写一对 serialize/deserialize"。

### round-trip harness

- **方案**：jsdom。`createTestEditor(markdown)`（`packages/editor/src/testing/create-test-editor.ts`）在 jsdom 中创建无 React 的 Milkdown Editor（commonmark + GFM preset），`getMarkdown()` 返回序列化结果，无需启动 Electron。
- **用法**：用例写在 `packages/editor/src/roundtrip.test.ts`，形如：

  ```ts
  expect(await roundtrip(input)).toBe(expected)
  ```

- **差异登记规则（R1）**：任何序列化规范化差异（列表符号、Setext→ATX、围栏形态、表格对齐/填充、空行收敛等）必须：
  1. 在用例上方以 `// Registered normalization (R1): ...` 注释说明差异；
  2. 期望值显式写出精确序列化结果（`toBe`），禁止 `toMatch`、禁止跳过；
  3. 长文档 fixture（`packages/editor/src/__fixtures__/long-doc-*.md`）的整篇序列化结果登记在同名 `.expected.md` 快照中并精确比对。
- **回归判定**：凡未登记的差异视为回归——新增差异必须先登记再合入，不得静默改变用户格式。

## 6. 回归清单（发布/合并必查）

### R1 — 往返保真（CI 自动）

- [ ] `pnpm test` 全绿，其中 `roundtrip.test.ts` 必须全绿。
- [ ] 三篇基准长文档：**零编辑保存不写盘**——保存前后文件哈希与 mtime 均不变。
- [ ] 编辑后的序列化差异逐条登记在 `roundtrip.test.ts`；未登记的差异视为回归。

### R2 — 中文 IME（手测）

- [ ] 标题 / 列表项内拼音连打、选字、撤销。
- [ ] 表格单元格内 IME + 回车确认候选。
- [ ] IME 组合中不允许触发输入规则（如拼音中含 `#` 不应建标题）。
- [ ] （公式块 IME 属 v1.1，v1 不检查。）

### R3 — 模式切换（手测 / e2e）

- [ ] 渲染 ↔ 源码各切 10 次：内容一致、**光标所在行列一致**（对应 `cursor-map` 返回 `exact`）。
- [ ] `ancestor` / `none` 降级路径有登记用例，且不会静默丢位置。
- [ ] 滚动位置按相对比例恢复。
- [ ] 切换后的撤销栈行为与 `architecture.md` ADR 一致。

### R4 — 文件可靠性（手测 / e2e）

- [ ] 自身保存不触发「外部修改」弹窗（写入凭证抑制生效）。
- [ ] 外部程序改文件：Buffer 干净时自动重载；脏时弹窗二选一。
- [ ] 保存原子性：写盘失败不留半个文件，`.tmp` 被清理。
- [ ] CRLF/LF 与 BOM 保留。

### R5 — 性能（每里程碑测一次，结果记录到第 7 节）

- [ ] 安装包（下载体积）≤150MB；安装后磁盘占用 ≤400MB。
- [ ] 冷启动（第二次及以后）< 3s；首次启动 < 8s。
- [ ] 空文档常驻内存 ≤300MB（单窗口、release 构建、全部 md-editor 进程私有工作集之和）。
- [ ] 打开 1MB markdown < 500ms；10k 文件夹索引 < 3s。
- [ ] 万行文档滚动不掉帧。
- [ ] 平台覆盖：Windows 本机手测；macOS / Linux 由 CI 构建 + 冒烟覆盖，未做人工验证的项必须在第 7 节写明。

### R6 — 无障碍（手测）

- [ ] 全键盘可达（Tab/Shift+Tab 顺序正确）。
- [ ] 焦点环可见。
- [ ] 对比度抽查（正文、次要文字、代码）。

### R7 — 进程与安全（CI 断言 + 手测）

- [ ] `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`（代码断言存在）。
- [ ] 生产构建 CSP 中无 `unsafe-eval`、无远程脚本。
- [ ] 渲染进程无法直接访问 `require` / `fs`（devtools 里 `window.require === undefined`）。
- [ ] 外链只经 `shell.openExternal`，且协议限 http/https。

## 7. 性能基准记录

| 日期       | 提交    | 包体                          | 冷启动（第二次） | 空文档内存 | 1MB 打开   | 平台/备注                                                                                                                                            |
| ---------- | ------- | ----------------------------- | ---------------- | ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-15 | 2b4da21 | 未打包（请先执行 pnpm build） | 340ms            | 408MB      | 未测（M1） | win32；内存=所有进程 workingSetSize 之和；getAppMetrics 仅暴露 workingSetSize，非私有工作集                                                          |
| 2026-10-15 | 2b4da21 | 未打包（请先执行 pnpm build） | —                | 186MB      | 未测（M1） | win32；Get-Process electron PrivateMemorySize64 之和，第二次启动，4 个 electron 进程；与 architecture.md 5 节「私有工作集之和」口径一致，≤300MB 达标 |

两种口径采样时刻不同（getAppMetrics 由主进程在 ready-to-show 时写入，Get-Process 为外部事后采样），数值仅供基线参考；M5 发布验收以私有工作集口径为准。

## 8. 调试技巧

- 渲染进程 devtools：开发模式 `Ctrl+Shift+I`（生产包关闭）。
- 主进程日志：`ELECTRON_ENABLE_LOGGING=1 pnpm dev`，或经 electron-log 输出到终端/文件。
- 编辑器状态检查：开发模式下 console 里 `window.__md_debug.doc()` 可打印当前编辑器 Doc JSON 与 mdast（仅开发模式注册）。
- 切换问题排查：`window.__md_debug.cursor()` 打印最近一次 `captureSelection` / `restoreSelection` 的结果（含 `exact` / `ancestor` / `none`）。
- round-trip 失败排查：`pnpm test -t roundtrip`，diff 工具会输出两版本文本差异。
- Windows + 代理环境首次运行 Electron：二进制下载不走系统代理环境变量，需要 `ELECTRON_GET_USE_PROXY=true` + `GLOBAL_AGENT_HTTPS_PROXY=<代理地址>`（仅首次；二进制已缓存后无需设置）。
