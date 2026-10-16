# 任务

在 `D:\Develop\md-editor` 执行 md-editor **M1 编辑内核**。M0（Electron 骨架）已完成并打标 `m0-electron`。严格遵循 superpowers 开发流程，不许跳步。

## 0. 先读，再动手

按顺序读完：

1. `AGENTS.md` —— 三条铁律与硬约束，**最高优先级**
2. `architecture.md`（3.1 唯一事实源 / 3.2 键入收敛 / 4 ADR-2）、`component-api.md`、`development.md`（5 节新增节点流程 / 6 节 R1 R2）、`TODO.md`（M1 段）、`DESIGN.md`
3. `docs/superpowers/plans/2026-10-15-m0-electron-skeleton.md` —— 了解 M0 已交付的代码结构（`packages/editor` 现有 `EditorHost.tsx` + `sync.ts`，已挂 commonmark + gfm + history + listener；`packages/app` 有 `MdDocument` / `ipc`；e2e 现有 7 例必须保持全绿）

然后核对仓库现状：`git log --oneline -5`、`git status`、`pnpm test`、`pnpm e2e` 应全绿（这是你动第一行代码前的基线）。

接着调用 `superpowers:using-superpowers`，并按 `writing-plans` 的交接规则先产出 **M1 实施计划**（保存到 `docs/superpowers/plans/2026-10-16-m1-editor-kernel.md`），问我要执行方式（Subagent-Driven 推荐 / Inline）；multi-agent 不可用则直接说明并改用 Inline。

## 1. M1 范围（来自 TODO.md，优先级 P0 > P1 > P2）

- (P0) Milkdown preset 与输入规则：`#`、`>`、`-`、`1.`、代码围栏、表格管道
- (P0) GFM：表格、任务列表、删除线
- (P0) round-trip 差异登记用例集：**不少于 50 用例 + 3 篇真实长文档**，进 CI
- (P0) 中文 IME 专项验证（标题 / 列表 / 表格）
- (P1) 会话级撤销栈持久化
- (P1) 粘贴处理：HTML → Markdown、URL → 链接、图片粘贴存盘
- (P2) 脚注（GFM 扩展；若延期必须在 v1 发布说明注明）

验收：round-trip 用例全绿；Typora 日常写作 80% 场景不卡壳。

## 2. 环境与硬约束（偏离前必须先问我）

- 平台 Windows + PowerShell；Node 24 / pnpm 11 / git 已装。**零安装约束**：不装 Rust/MSVC/WSL/Docker 及任何系统级工具。
- 壳 = Electron 44 + electron-vite；**不引入第二套 Markdown 解析器/编辑器内核**（铁律 3）；解析/序列化一律走 Milkdown 内置管线。
- **不要创建 `packages/md-bridge`**；round-trip 用例写在 `packages/editor/src/roundtrip.test.ts` 一线。
- Buffer 唯一事实源；渲染模式键入经 300ms 防抖收敛回 Buffer（`packages/editor/src/sync.ts` 已实现，不要破坏它）。
- 序列化控制权在 Milkdown：任何规范化差异（列表缩进、强调符号、空行、表格对齐等）必须**逐条登记为用例**，禁止静默改变用户格式。
- 零编辑保存 = 完全不写盘（已实现，别改坏）；`MdDocument.bytesForSave(): string | null` 语义保持。
- 安全基线不可放宽：`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`；新增能力必须同时改 preload 白名单 + 主进程 handler + `component-api.md` 7 节 IPC 表。
- 不做覆盖率门禁；CI 的 `check`/`build` 两个 job 保持通过（e2e 在 CI 里走 `xvfb-run`）。

## 3. M1 的关键风险与做法（计划里必须覆盖）

- **round-trip harness 是 M1 最大不确定性**：Milkdown 的 Editor 需要 DOM，纯 node 环境跑不了。计划里第一个任务必须是 **harness spike**：
  1. 优先尝试 Vitest + `jsdom`（`@milkdown/kit` 的 `Editor.make().create()` 能否在 jsdom 完成 parse → PM → `getMarkdown()`）；
  2. 若 jsdom 不可行，退而用 Playwright（`_electron` 启动真实应用，经 `window.__md_debug` 之类的开发钩子喂入/取出 Markdown；需要时先在 `packages/editor` 加这个 dev-only 钩子并在 `component-api.md` 登记）；
  3. **先用 5 个用例验证 harness 稳定不 flaky，再铺开 50 个**，并把最终 harness 方案写进 `development.md` 5 节。
- **输入规则验证**：Milkdown commonmark/gfm preset 自带大部分输入规则，M1 的任务是**逐条实测** `#`、`>`、`-`、`1.`、``` 围栏、`| a | b |` 表格管道、`[] `/`[x] ` 任务列表，缺的才补自定义 input rule（注册方式见 `development.md` 5 节）。输入规则可用 e2e 键入验证（`keyboard.type` 后断言 DOM/序列化结果）。
- **IME 专项是手测**（Windows 11 + 微软拼音）：标题 / 列表项连打、选字、撤销；表格单元格 IME + 回车确认；IME 组合中含 `#` 不得触发输入规则。结果记录进 `development.md` 6 节 R2（通过项打勾 + 注明日期与环境），失败项在 `TODO.md` M1 增加缺陷条目并停下来告诉我。
- **3 篇真实长文档**：放 `packages/editor/src/__fixtures__/`（或 e2e/fixtures），来源可以是本仓库文档本身 + 手写的大表格/长列表混合文档；它们既是 round-trip 用例也要能通过零编辑保存的哈希断言。
- **图片粘贴存盘**涉及主进程写盘：走既有 `doc:write` 通道之外需新增专用通道（如 `asset:save`），按 `development.md` 4 节要求同时改 preload 白名单、主进程 handler、`component-api.md` 7 节，并遵守路径策略（文档同目录 `assets/`）。

## 4. 每个 Task 的做法

- 按步骤：写失败测试 → 运行确认失败（贴输出）→ 最小实现 → 运行确认通过 → 提交（英文祈使句 + scope，如 `feat(editor): register table input rule`）。
- 每个 Task 结束：把计划里的 `- [ ]` 勾成 `- [x]`，给我简报（改了哪些文件 / 跑了哪些命令 / 结果 / 下一 Task）。
- **M0 的 e2e 7 例必须始终全绿**；新增 e2e 只能加不能删。
- 立即停下来问我：与 `AGENTS.md` / `architecture.md` 冲突；依赖版本或 API 与计划假设不符；需要新增第三方依赖（尤其任何编辑器/解析器方向的包——那会踩铁律 3）；IME 出现无法绕过的缺陷。
- 可自主修：测试报错、类型错误、格式问题、路径拼写。修完在简报说明，真正的偏离登记进计划末尾「已知偏离与登记」表。

## 5. 收尾

- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm e2e` / `pnpm build:app` 全绿。
- `TODO.md` M1 条目勾选 + 验收记录（含 round-trip 用例数、长文档数、IME 手测结论）。
- `development.md` 6 节 R1/R2 更新；`component-api.md` 与实现对齐；新视觉表现（如有）登记 `DESIGN.md`。
- 提交并 `git tag m1-editor-kernel`；最后给我总结（完成情况、逐条验收结果、偏离清单、未验证项）。

## 6. 不许做的事

- 没跑过命令就声称"通过"——每个结论都要附真实输出摘要。
- 为了让测试变绿而修改断言、跳过失败用例、引入第二套解析器，或把未完成项标成已完成。
- 触碰 `packages/md-bridge`（不存在）或把序列化逻辑搬出 `packages/editor`。
