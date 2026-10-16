# md-editor 交接文档：M1 完成 → M2 启动（2026-10-16）

> 用途：新对话/新会话接手 md-editor 开发时的完整上下文。先读 AGENTS.md，再读本文。历史计划见 `docs/superpowers/plans/`。

## 1. 当前状态（一句话）

M0（Electron 骨架，tag `m0-electron`）与 M1（编辑内核，tag `m1-editor-kernel`，HEAD f34e09b）均已完成并全绿；下一步是 M2（源码模式与块级组件），尚未开工。

## 2. 验收基线（打标时真实数字）

- `pnpm typecheck`：3 个 tsconfig 0 错误
- `pnpm lint`：ESLint + Prettier 全过
- `pnpm test`：10 files / 119 passed（含 `roundtrip.test.ts` 71 用例 + 3 篇长文档 fixture）
- `pnpm e2e`：27 passed（M0 7 例 + 输入规则 9 + IME 6 + paste 2 + footnote 2 + undo-session 1）
- `pnpm build:app`：main 56.9KB / preload 2.08KB / renderer 1397KB

## 3. M1 交付清单（接手者需要知道的关键事实）

### 代码结构（packages/editor/src/）

- `EditorHost.tsx`：Milkdown 挂载组件。插件链 = commonmark + gfm + history + listener + `editorInputRules` + 脚注插件 + session recorder + paste 插件（导出名以 `index.ts` 为准）。props：`docId` / `initialMarkdown` / `onMarkdownChange` / `onReady(EditorHandle)` / `onPasteAsset?`。
- `sync.ts`：300ms 防抖收敛（Buffer 唯一事实源的核心，**不得破坏**）。
- `input-rules.ts`：`editorInputRules`——表格管道 `| a | b |` + Enter 转表格（复用 gfm 节点），支持 `\|` 转义。
- `footnotes.ts`：GFM 脚注。remark-gfm 内置 footnote 节点 + `$remark` 补丁（未定义引用补建 footnoteReference）+ `$prose` 键入规则。已知局限登记在 component-api.md 3.6。
- `session-history.ts`：会话级撤销。**step JSON 重放方案**（Milkdown history key 不导出、HistoryState 不可序列化——不要尝试直接注入）。recorder plugin 记录事务，重挂时重放重建撤销/重做栈；重放期有 `restoring` 抑制 + recorder 状态重置（评审修过基线污染 bug，改这里先读单测）。
- `paste.ts`：`htmlToMarkdown`（Milkdown 同一 schema DOMParser）+ URL→链接 PasteRule + 图片粘贴 handlePaste 回调。
- `testing/create-test-editor.ts`：jsdom round-trip harness（`@vitest-environment jsdom`）。round-trip 用例全在 `roundtrip.test.ts`，差异登记规则见 development.md 5 节。

### IPC（M1 新增）

- `asset:save`：preload `saveAsset(docPath, bytesBase64, ext)` → 主进程写 `<docDir>/assets/<时间戳>-<rand>.<ext>`，复用 `writeAtomic`。ext 白名单常量在 `electron/shared/asset.ts`。三处同步（preload / main / component-api.md 7 节）已对齐。

### 文档状态

- `TODO.md`：M0/M1 全部勾选 + 验收记录；持续性任务区有待办（见 §5）。
- `component-api.md`（仓库根）：3.1–3.8 与实现对齐；3.5 parseOutline/countWords 是 M3 计划 API 未实现。
- `development.md`：5 节含 round-trip harness 约定；6 节 R2 含 IME 结论（CDP 自动化模拟）。
- `docs/superpowers/plans/2026-10-16-m1-editor-kernel.md`：完整执行记录 + 已知偏离表 #1–#14（**接手前必读偏离表**）。

## 4. 已知偏离/风险摘要（详见计划偏离表）

| #        | 主题                                                                         | 状态                                                 |
| -------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| 2/3/4/12 | Milkdown 序列化规范化（bullet→`*`、表格最小分隔、转义混合段丢转义等 10+ 类） | 已逐条登记为用例，禁止再静默新增                     |
| 5        | 表格管道 Enter 自定义 keymap                                                 | 复用 gfm 节点，无第二解析器                          |
| 6/7      | 撤销栈 step 重放 + 重放抑制                                                  | 语义完整，有专项单测                                 |
| 8        | IME 为 CDP 自动化模拟                                                        | 真人微软拼音手测**待补**（候选窗/确认键/组合内撤销） |
| 13       | asset:save 无大小上限/magic bytes 校验                                       | TODO 持续性任务，M4 收口                             |

## 5. 未验证项 / 悬置任务（TODO 持续性任务区）

- [ ] 真人 IME 手测（需用户配合）
- [ ] asset 写盘安全加固（大小上限 + magic bytes，M4 前）
- [ ] IPC bytesBase64 入参守卫（doc:write / asset:save，M2 顺手）
- [ ] EditorHost 卸载 `sync.dispose()` 丢 pending flush 的兜底语义（现靠 session-history 重放兜底，M2 登记/flush）
- [ ] component-api.md 位于仓库根，M2 考虑归位 docs/
- [ ] round-trip 差异用例扩充（每新增节点必须同步登记，development.md 5 节流程）

## 6. M2 范围（来自 TODO.md，未开工）

- (P0) `cursor-map`：`pmPosToMdPath` / `mdPathToPmPos` / Markdown 偏移互转（纯函数 + 单测；语义见 architecture.md 3.4 五条口径）
- (P0) CodeMirror 6 源码模式：双向切换 + 光标精确恢复（验收：切换 10 次内容与光标行列一致）
- (P0) 代码块组件：语言选择、复制按钮、高亮
- (P1) 表格增强：行列增删、列宽拖拽、对齐保留
- (P2) 图片拖拽调整尺寸（v1.1 再考虑）

注意：CodeMirror 6 目前**完全未引入**（dependency 不存在），M2 才加；cursor-map 需要新文件 `packages/editor/src/cursor-map.ts`（纯函数、禁 DOM/IO，改它必须附 development.md 6 R3 回归）。

## 7. 工作方式约定（沿用 M1）

- 流程：superpowers 流程 + subagent-driven（计划先行，TDD，每 Task 评审）。**AGENTS.md 末尾「AI 执行效率规范」7 条必须遵守**（子代理指令最小化 / lint+typecheck 前置硬门槛 / 长等待 / 文本编辑用脚本文件 / agent 即用即关 / 验证抽查 / 输出压缩）。
- 硬约束不变：Buffer 唯一事实源、零编辑不写盘、单内核、安全基线、TypeScript strict 禁 any、提交英文祈使句 + scope、M0 e2e 只加不删。
- 多任务连续执行不中途请示；仅四类停：不可逆/安全/越权副作用/计划全靠猜。
- 环境：Windows + PowerShell，Node 24 / pnpm 11；零安装约束（禁 Rust/MSVC/WSL/Docker）。

## 8. 快速上手命令

```powershell
git log --oneline -5        # HEAD 应为 f34e09b，含 m1-editor-kernel tag
git status                  # 应干净
pnpm test                   # 119 passed
pnpm e2e                    # 27 passed（含 build:app）
```
