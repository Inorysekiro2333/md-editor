# md-editor 交接文档：M2 P0 完成 → M2b 启动（2026-10-16）

> 用途：新对话/新会话接手 md-editor 开发时的完整上下文。先读 AGENTS.md（含 2026-10-16 新增「CI / E2E 教训」节），再读本文。M1 交接见 `2026-10-16-m1-done-m2-start.md`；M2 完整执行记录见 `docs/superpowers/plans/2026-10-16-m2-source-mode.md`（含全部 Rulings 与 Ledger，**接手前必读 Ledger**）。

## 1. 当前状态（一句话）

M0/M1 + **M2 全部 P0**（cursor-map、CodeMirror 6 源码模式、代码块组件）+ 两项顺手持续性任务已完成并合入 main（HEAD `3d4a497` 附近），CI 全绿；**M2 P1 表格增强未开工**（下个计划 M2b），M3 需在 M2b 后启动。

## 2. 验收基线（打标时真实数字）

- `pnpm typecheck`：3 个 tsconfig 0 错误
- `pnpm lint`：ESLint + Prettier 全过
- `pnpm test`：175 passed (15 files)，其中 cursor-map 31 例、roundtrip 75 例
- `pnpm e2e`：31 passed（Linux CI run 38917832792 全绿，check + 三平台 build）
- `pnpm build:app`：main 57.74 kB / preload 2.08 kB / renderer ~1.80 MB
- 零编辑保存不写盘：e2e 用例覆盖（mtime+size 不变）

## 3. M2 交付清单（接手者需要知道的关键事实）

### cursor-map（packages/editor/src/cursor-map.ts，纯函数，禁 DOM/IO）

- 6 个导出：`mdOffsetToCursor` / `cursorToMdOffset` / `pmPosToMarkdownOffset` / `markdownOffsetToPmPos` / `pmPosToMdCursor` / `mdCursorToPmPos`；`MdCursor = { path: number[]; offset: number }`（mdast children 下标路径，offset 相对节点 start）；`accuracy: 'exact' | 'ancestor'`。
- 语义：以 remark mdast position 为坐标系（unified@11.0.5 + remark-parse@11.0.0 + **remark-gfm@4.0.1**，与 Milkdown transformer 同管线）；PM↔mdast 平行游走（lockstep），结构不对应处顶层块级 fallback → `ancestor`，**永不 throw**。
- 退化语义（architecture.md 3.4 第 3 条）：path 失效 → 最近祖先 + 块首；块级边界恢复 = `TextSelection.near(pos, +1)` 取**后方块首**。
- **leaf 末尾双向精确**已修（CI 自查发现的真 bug：原子叶子锚点非 exact），6 组末尾双向用例 + 全 fixture 块末往返断言。

### 源码模式（packages/editor/src/source-editor.tsx）

- CodeMirror 6（state/view/commands/language/lang-markdown/language-data ^6）；复用 `createMarkdownSync` 300ms 防抖；`initialMarkdown` 只在 mount 读一次；`setSelectionOffsets` 超界 clamp。
- App 层模式切换（`packages/app/src/App.tsx`）：`toggleMode()` = flushNow → capture（Markdown offset anchor/head + scrollRatio）→ setMode → onReady 恢复；mode 存 appStore（'wysiwyg' | 'source'）；Ctrl+/ 在 window **capture 阶段**拦截 + stopPropagation（CM 默认绑注释切换）；header 按钮 `data-testid="mode-toggle"`。
- `data-editor-ready` 属性：App onReady 置位，doc/reloadToken 变化复位——e2e 与任何依赖「编辑器就绪」的逻辑必须等它。

### 代码块组件（packages/editor/src/code-block-view.ts）

- **自建** vanilla TS CM6 NodeView（Ruling-1：Milkdown 官方 `@milkdown/kit/component/code-block` 是 Vue 实现，禁用）。
- 挂载方式：`$view` 在 Milkdown 7.22.3 不可用（schema plugin 未赋值 key=undefined）→ 自注册 `nodeViewCtx` 插件（key 固定 `code_block`，等 SchemaReady）。
- 语言 select：`@codemirror/language-data` 懒加载高亮（`LanguageDescription.matchLanguageName` + Compartment；无静态 matchLanguages）；**未收录的 fence 语言保留为动态 option**（不静默改写用户语言）。
- 复制按钮 = navigator.clipboard；CM↔PM 同步有 `updating` 防回环、PM→CM 保留光标、内容未变跳过。

### IPC 与同步语义变更

- `electron/shared/base64.ts`：doc:write / asset:save 载荷守卫（非 string / 非法 base64 / 超 10MB·20MB → Error('invalid payload')，不写盘）。
- `sync.dispose()` 改为**先同步 flush pending**（并保留 onFlush 重入产生的新 timer）——unmount 不再丢 Buffer 收敛；session-history 重放仍兜底。

### e2e 基础设施（新对话写 e2e 前必读 AGENTS「CI / E2E 教训」节）

- `__mdEditorDebug` 只读钩子：`pmSelection()`（EditorHost）/ `cmSelection()`（SourceEditor）——e2e 光标断言**一律用它**，禁 DOM 选区测量。
- `e2e/source-mode.spec.ts` 3 例（状态真值断言、10 次切换、零编辑不写盘、source 编辑带回）+ `e2e/code-block.spec.ts` 1 例 + ime code block 用例等待 NodeView 就绪。

## 4. 已知偏离 / 风险摘要（详见计划 Rulings 与 Ledger）

| #   | 主题                                                           | 状态          |
| --- | -------------------------------------------------------------- | ------------- |
| R1  | 代码块禁用 Milkdown Vue 版组件，自建 NodeView                  | 已执行        |
| R2  | 本计划只做 P0+顺手项；P1 表格增强留 M2b                        | **待做**      |
| R3  | 选区交换格式 = Markdown offset；mdast {path,offset} 为保存形态 | 已实现        |
| R4  | 滚动恢复 = scrollRatio 最小版（非逐块视口比例）                | 简化已登记    |
| —   | `__mdEditorDebug` 留作 e2e 基础设施（只读）                    | 已登记 Ledger |

## 5. 未验证项 / 悬置任务（TODO 持续性任务区）

- [ ] 真人微软拼音 IME 手测（M1 遗留，需用户配合；CDP 自动化已覆盖）
- [ ] 代码块 CM→PM 整块替换：大代码块撤销粒度粗（M3 前跟进）
- [ ] 全局快捷键注册表（Ctrl+/ 目前 window capture 拦截，新增快捷键前先统一）
- [ ] M3 需补冷启动/内存实测（≤300MB 口径；M2 未测）
- [ ] asset 大小上限已做（10/20MB），magic bytes 校验仍留 M4

## 6. M2b 范围（下个对话的计划输入）

- (P1) 表格增强：行列增删、列宽拖拽、**对齐保留**（对齐序列化差异须按 development.md 5 节登记，禁止静默改格式）
- 建议按同流程执行：superpowers 计划先行 + subagent-driven + TDD；开工前重读 M2 计划的 Rulings/Ledger 与 AGENTS「CI / E2E 教训」节
- M2b 完成并 CI 全绿后才进入 M3

## 7. 工作方式约定（沿用，新增加粗）

- 流程：superpowers 计划先行 + subagent-driven（每 Task 评审）+ TDD；**AGENTS「AI 执行效率规范」7 条与「CI / E2E 教训」6 条必须遵守**。
- 硬约束不变：Buffer 唯一事实源、零编辑不写盘、单内核、TypeScript strict 禁 any、依赖方向 app → editor/export/theming、M0-M2 e2e 只加不删、提交英文祈使句 + scope。
- 多任务连续执行不中途请示；仅四类停：不可逆/安全/越权副作用/计划全靠猜。
- **共享 checkout 警告**：本仓库 checkout 会被用户并行会话使用——子代理禁止切分支；合并他人提交前先 `git log` 确认归属。
- 环境：Windows + PowerShell，Node 24 / pnpm 11；零安装（禁 Rust/MSVC/WSL/Docker）。

## 8. 快速上手命令

```powershell
git log --oneline -5          # main，含 M2 全部合并
git status                    # 应干净
pnpm test                     # 175 passed (15 files)
pnpm e2e                      # 31 passed（先 build:app）
```
