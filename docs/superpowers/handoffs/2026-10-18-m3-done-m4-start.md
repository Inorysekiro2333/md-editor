# md-editor 交接文档：M3 完成 → M4 启动（2026-10-18）

> 用途：新对话/新会话接手 md-editor 开发时的完整上下文。先读 AGENTS.md（含「CI / E2E 教训」「AI 执行效率规范」两节），再读本文。上一份交接见 `2026-10-16-m2-p0-done-m2b-start.md`；M2b 与 M3 的完整执行记录（含全部 Rulings）见 `docs/superpowers/plans/2026-10-17-m2b-table-enhancement.md` 与 `docs/superpowers/plans/2026-10-17-m3-workbench.md`（**接手前必读两份 Ledger**）。

## 1. 当前状态（一句话）

M0–M3 全部完成并合入 main（HEAD `e1aebd8` 附近），CI run 39047427455 全绿（check + 三平台 build）；**M4（主题与导出）未开工**，M5 发布在其后。

## 2. 验收基线（打标时真实数字）

- `pnpm typecheck`：3 个 tsconfig 0 错误
- `pnpm lint`：ESLint 0E/0W + Prettier 全过
- `pnpm test`：243 passed (25 files)
- `pnpm e2e`：44 passed（Linux CI 一遍过；external-choice 已加固等待并 `--repeat-each=3` 6/6 稳定）
- `pnpm build:app`：成功（renderer ~1.83 MB）
- 10k 文件 walk 实测 **32.8ms**（预算 3s；`electron/main/workspace.test.ts` 性能用例）

## 3. M3 交付关键事实（接手者必须知道）

### 标签页与关闭确认（packages/app/src/state/appStore.ts、App.tsx）

- `docs: MdDocument[] + activeDocId`；`openDoc` 按 path 去重激活；`closeDoc` 关活跃时激活**左邻**，关非活跃不动当前。
- MdDocument 是可变对象，脏变化不触发 zustand——App 用 `bumpDirtyTick` 重渲染脏标记。
- 双关闭确认：标签 × 与窗口 × 都弹 Modal；窗口守卫受 `MD_EDITOR_NO_CLOSE_GUARD` 门控（`playwright.config.ts` 顶部默认置 `'1'`，e2e 透传；测关窗确认的用例自行覆盖为 `''`）；主进程 `before-quit → markQuitting()` 旁路守卫防 app.quit() 自锁。

### 主进程 watcher（electron/main/ipc.ts、watcher.ts、workspace.ts）

- 文件 watcher = `Map<path, FSWatcher>`；写入凭证 = `Map<path, WriteCredential>`（**按 path 查表抑制自身事件**，多 tab 保存互不误报）。
- watch/unwatch/openWorkspace/dispose 全部经 promise 链串行化（`createWatcherRegistry`），并发只建一个 watcher。
- workspace walk 规则：忽略 `node_modules/.git/out/dist/.svn/.idea`，只收 `.md/.markdown`，目录优先 + localeCompare 排序；增量事件 100ms 批量合并，`removed` 触发 renderer 全量重拉。
- 性能用例阈值 15s（防 CI 抖动），真实值见 TODO。

### 大纲（packages/editor/src/outline.ts、cursor-notify.ts）

- `parseOutline` 纯 remark 函数（与 cursor-map 同管线），**只走 root 顶层 children**（引述/列表内标题不算）；ATX `textOffset = offset + level + 1`，setext 无标记前缀。
- `createCursorNotifyPlugin`：PM 侧 150ms leading+trailing 节流 + `pmPosToMarkdownOffset(bufferText, …)` 映射（buffer 可能落后 300ms，映射 fallback 安全不抛）；SourceEditor 走 CM updateListener 直接回传 md offset。
- 高亮语义：active = 最后一个 `cursorOffset >= item.offset` 的项。

### 查找替换（packages/app/src/find/finder.ts、FindReplacePanel.tsx）

- Buffer 级：Replace = 单次 `MdDocument.replaceText` + `reloadToken++` 重挂载（**ADR-6 偏离已登记 component-api.md §4.0**：PM ReplaceStep → Buffer replaceText，会话撤销栈兜底）；regex `$1` 仅 regex 分支生效，非 regex 字面量。
- `computeMatches`：空 query/非法 regex → `[]`；零长匹配跳过；重叠不重复取。
- **顺手修复**：cursor-map 软换行缺陷（mdast text 含 `\n` vs PM hardbreak 导致整段 fallback）——按 `\n` 切分 text 叶子插伪 break 叶子，R3 回归全绿（cursor-map 属高危区，此改动已附回归证据）。

### 外部修改与会话恢复

- 外部修改三态：干净 doc → 自动重载；脏活跃 doc → 立即二选一 modal；脏后台 doc → `pendingExternalPaths` 记账，**激活该 tab 时**才弹窗。
- 会话恢复（ADR-7）：快照 `userData/session.json` 原子写，renderer 5s interval 只在存在脏 doc 时写；**失效语义**：保存转净 / 放弃更改关闭（标签或窗口）/ 外部重载转净 → `removeSession()` 删除文件；restore 仅 `hasCliOpen === false` 时执行（appInfo 新增 `hasCliOpen`），文件缺失跳过、dirty tab 用快照 text + 磁盘 originalBytes + `dirty: true` 初始化 MdDocument。
- 外部重载（含干净自动重载）前调 `clearHistory()`——旧基线会话事务重放会复活「保留的内容」（e2e 实测暴露）。

### IPC 通道增量（channel 名单见 electron/shared/channels.ts + component-api.md §4.2）

`watch:unwatch` / `workspace:open` / `workspace:tree` / `workspace:update` / `app:close-guard` / `app:confirm-close` / `session:save` / `session:load` / `session:remove` + appInfo.`hasCliOpen`。preload/bridge.d.ts/ipc.ts 四处必须同步（改通道时逐一核对）。

## 4. 已知偏离 / 风险摘要（详见两份计划 Ledger）

| #    | 主题                                                                                      | 状态           |
| ---- | ----------------------------------------------------------------------------------------- | -------------- |
| M2b  | 列宽拖拽 colwidth 不序列化；光标移入新行/列；表头行禁删                                   | 已实现+登记    |
| M3-1 | ADR-6 查找替换改 Buffer 而非 PM ReplaceStep                                               | 已登记 §4.0    |
| M3-2 | removed 全量重拉窗口内事件可能丢失                                                        | 计划允许的从简 |
| M3-3 | 编辑后 ~500ms 内 Ctrl+S 可能误报「无改动」（listener 200ms debounce + sync 300ms 未收敛） | **M4 前跟进**  |

## 5. 未验证项 / 悬置任务（TODO 持续性任务区）

- [x] **真人微软拼音 IME 手测（M1 遗留）——2026-10-18 人工测试通过**（pnpm dev，Windows 11 + 微软拼音，用户真人验证；CDP 自动化此前已覆盖）。原清单：
  - 标题 / 列表项 / 表格单元格 / 代码块内：拼音连打、候选窗选字、确认键上屏
  - 组合内撤销（候选未确认时 Ctrl+Z）
  - 组合中 `#` `-` `1.` 不应触发输入规则
  - 表格内 Enter 确认候选（真实 IME 吞 Enter 的路径）
- [ ] 万行文档滚动（Milkdown 视口外惰性渲染属 v1.1，M3 未加逐帧断言）
- [ ] Task 2 四项 Minor：watcher flush 计时器未清、removed 重拉窗口事件间隙、FileTree expanded Map 残留、preload 层 openWorkspace 校验
- [ ] loadSession 无 schema 校验；大纲全量 re-parse 大文档可优化；fakeState 构造登记基础设施
- [ ] asset magic bytes 校验（M4）

## 6. M4 范围（下个对话的计划输入）

- (P0) 主题系统 + 内置 3 主题（github-light / github-dark / paper-serif，CSS 变量，`pnpm theme:check`）
- (P0) 设置中心（settings.json + UI 面板）
- (P0) 导出 PDF：`webContents.printToPDF()` 静默导出
- (P1) 导出自包含 HTML（内联 CSS、图片 base64 可选）
- (P1) `theme:check` 校验脚本
- 顺手项（2026-10-18 人工测试裁定新增）：
  - (P1) 自定义原生菜单：全屏切换可退出（当前是 Electron 默认菜单，全屏后菜单隐藏无法退出；F11 为逃生通道）、退出确认接入关窗守卫，全局快捷键注册表一并统一
  - (P1) 新建未命名笔记 + 另存为 Save As（当前无文件只能空态等待；Save As 全程未排期，属真实功能缺口；主进程 dialog + 未命名 tab）
  - Task 2 Minor 清理、Ctrl+S 500ms 竞态（R3 项）、asset magic bytes
- 建议同流程：superpowers 计划先行 + subagent-driven + TDD；M3 的 Rulings/Ledger 与 AGENTS 两节必读

## 7. 工作方式约定（沿用）

- 流程：superpowers 计划先行 + subagent-driven（每 Task 评审）+ TDD；AGENTS「AI 执行效率规范」7 条与「CI / E2E 教训」6 条必须遵守。
- 硬约束不变：Buffer 唯一事实源、零编辑不写盘、单内核、TS strict 禁 any、依赖方向 app → editor/export/theming、e2e 只加不删、提交英文祈使句 + scope。
- 共享 checkout 警告照旧：子代理禁切分支；合并他人提交前先 `git log` 确认归属。
- 环境：Windows + PowerShell，Node 24 / pnpm 11；零安装（禁 Rust/MSVC/WSL/Docker）。
- push main 即触发 CI，推送后必须盯 run 到完成（`gh run watch <id> --exit-status` + 逐 job 复核）。

## 8. 快速上手命令

```powershell
git log --oneline -5          # main，M3 全部合并
git status                    # 应干净
pnpm test                     # 243 passed (25 files)
pnpm e2e                      # 44 passed（先 build:app）
pnpm dev                      # 本地开发窗口（人工测试用）
```
