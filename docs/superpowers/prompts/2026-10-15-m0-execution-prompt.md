# 任务

在 `D:\Develop\md-editor` 执行 md-editor M0（Electron 骨架）。严格遵循 superpowers 开发流程，不许跳步。

## 0. 先读，再动手

按顺序读完：

1. `AGENTS.md` —— 三条铁律与硬约束，**最高优先级**
2. `architecture.md`、`component-api.md`、`development.md`、`TODO.md`、`project-overview.md`、`DESIGN.md`、`user-guide.md`
3. `docs/superpowers/plans/2026-10-15-m0-electron-skeleton.md` —— 11 个 Task，逐步 checkbox

然后核对仓库现状：目前只有 8 份根文档 + `docs/superpowers/`，**还不是 git 仓库**（Task 1 Step 1 负责 `git init -b main`），没有任何代码。

接着调用 `superpowers:using-superpowers`，并按 `writing-plans` 的交接规则问我要执行方式：Subagent-Driven（推荐）或 Inline（`executing-plans`）。如果 multi-agent 工具不可用，直接说明并改用 Inline。

## 1. 环境与硬约束（偏离前必须先问我）

- 平台 Windows + PowerShell；Node 24 / pnpm 11 / git 已装。
- **零安装约束**：不要安装 Rust、MSVC、WSL、Docker 或任何系统级工具——Electron 不需要它们。
- 桌面壳 = **Electron 44 + electron-vite**；禁止引入 Tauri / cargo。
- **不要创建 `packages/md-bridge`**；mdast ↔ PM 转换由 Milkdown 内置承担。
- 零编辑保存 = **完全不写盘**（不碰文件即保真），不是"写回原始字节"。
- 编辑内核只有 Milkdown；源码模式只有 CodeMirror 6；**M0 不实现 `cursor-map`**（那是 M2 P0），但不得给它制造障碍。
- 安全基线不可放宽：`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`；渲染进程禁止 `require('fs')`；新增 IPC 必须同时改 preload 白名单 + 主进程 handler + `component-api.md` 7 节 IPC 表。
- 性能口径：安装包（下载体积）≤150MB、安装后 ≤400MB、冷启动（第二次及以后）<3s、空文档常驻内存 ≤300MB。**不做覆盖率门禁**。

## 2. 每个 Task 的做法

- 按步骤执行：写失败测试 → 运行并确认失败（贴输出）→ 最小实现 → 运行确认通过 → 提交（英文祈使句 + scope）。
- 每个 Task 结束后：把计划里的 `- [ ]` 勾成 `- [x]`，给我一段简报（改了哪些文件 / 跑了哪些命令 / 结果 / 下一个 Task），然后继续。
- 出现以下情况**立刻停下来问我**，不要自行拍板：计划某步与 `AGENTS.md` / `architecture.md` 冲突；依赖版本或 API 与计划假设不符；需要新增第三方依赖或改动包结构；实测性能超出预算。
- 可自主修复：测试报错、类型错误、格式问题、明显的路径/拼写错误。修完要在简报里说明，并把真正的偏离登记到计划末尾的「已知偏离与登记」表。

## 3. 几个已知会踩的坑（计划里已写明，不要重犯）

- 根 `package.json` **不设** `"type": "module"`：`sandbox: true` 下的 preload 必须是 CJS。
- `.npmrc` **不要**写 `auto-install-peers=true`：否则会为 electron-vite 的可选 peer `@swc/core` 白装几十 MB。
- 主进程构建必须 `externalizeDepsPlugin({ exclude: ['chokidar'] })`：chokidar 5 是 ESM-only，CJS 主进程 `require` 会直接失败。
- Task 2 的 `packages/app/package.json` **不能**提前声明 `@md-editor/editor`（Task 6 才创建该包，提前声明会让 `pnpm install` 失败）。
- e2e 入口是根脚本 `pnpm e2e`（内部先 `pnpm build:app`），不要直接跑 `playwright test`。

## 4. Task 9 的特别说明（性能基线）

- Electron 的 `app.getAppMetrics()` 只能给 `workingSetSize`，**拿不到**文档口径里的"私有工作集"。先记录该值作为基线，并在 `development.md` 7 节写明测量工具与口径差异；若明显超过 300MB，停下来问我，**不许自行放宽数字**。
- 同时跑通 `printToPDF` 冒烟（断言产物以 `%PDF` 开头），这是 ADR-4 的证据。

## 5. 收尾（Task 11）

把实测数据写回 `development.md` 7 节；勾选 `TODO.md` M0 条目并追加验收记录；校对 `component-api.md` 与实现完全一致；全量跑 `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm e2e` / `pnpm build:app`，全绿后提交并 `git tag m0-electron`；最后给我一份总结（完成情况、逐条验收结果、偏离清单、未验证项）。

## 6. 不许做的事

- 没跑过命令就声称"通过"——每个结论都要附真实命令输出摘要。
- 为了让测试变绿而修改断言、放宽安全基线、跳过失败用例，或把未完成项标成已完成。