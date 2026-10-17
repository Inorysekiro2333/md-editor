# M3 工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 M3 工作台：多标签页（脏标记/关闭确认）、文件树工作区（chokidar 增量 + 虚拟滚动）、大纲面板（remark 派生 + 光标跟随）、查找替换（直接改 Buffer）、外部修改二选一、崩溃会话恢复。

**Architecture:** 渲染进程状态升级为 `docs: MdDocument[] + activeDocId`（zustand），MdDocument 每文档独立、主进程 watcher 升级为多文件 Map；文件树走主进程 `workspace.ts`（readdir 递归 + chokidar 增量推送，渲染进程零 Node）；大纲 = `packages/editor/src/outline.ts` 纯 remark 函数（禁 PM doc），光标跟随经新 `cursor-notify` 插件（EditorHost PM + SourceEditor CM 双实现）；查找替换是 Buffer 级 `MdDocument.replaceText`（ADR-6 单事务语义，替换后 reloadToken 重挂载、会话撤销栈兜底）；会话恢复走 ADR-7：主进程 appdata `session.json` 原子写，渲染 5s 快照脏文档，启动无 CLI 文件时还原。

**Tech Stack:** Electron 44 + React 18 + zustand + chokidar 5 + remark-parse/remark-gfm 11/4（同 cursor-map 管线）+ Vitest jsdom + Playwright Electron。

**Spec:** TODO.md「M3 — 工作台」+ architecture.md §2.1（workspace_index）、§3.5（外部修改二选一）、ADR-6/ADR-7 + development.md 命令定义。

## Global Constraints

- 渲染进程零 Node/fs：一切新能力经 `electron/shared/channels.ts` + `electron/preload` 窄接口，参数校验在 preload/main。
- Buffer 唯一事实源：大纲/查找都只读或改 Buffer，不绕过 MdDocument；零编辑不写盘语义不变。
- 单内核：大纲只用 remark/unified；禁 PM doc 派生大纲；禁引入第二解析器。
- 依赖方向 app → editor；e2e 只加不删；光标断言用 `__mdEditorDebug` 真值 + `[data-editor-ready="true"]` 门控。
- 性能口径：10k 文件索引 < 3s（后台不阻塞 UI）；万行文档滚动不卡顿（不做逐帧断言，e2e 冒烟即可）。
- TS strict 禁 any；提交英文祈使句 + scope；子代理禁切分支/push，直接提交当前分支。
- e2e 关窗守卫：main 在 `MD_EDITOR_NO_CLOSE_GUARD === '1'` 时跳过 dirty 关窗确认；playwright.config.ts 顶部 `process.env.MD_EDITOR_NO_CLOSE_GUARD ??= '1'`（electron.launch 的 env 已 `...process.env` 透传），需要测关窗确认的用例自行覆盖该变量。

---

### Task 1: 多标签页 + 脏标记 + 关闭确认

**Files:**

- Modify: `packages/app/src/state/appStore.ts`（docs/activeDocId + openDoc/closeDoc/setActive）
- Modify: `packages/app/src/App.tsx`（activeDoc 派生、TabBar、脏 tick、关闭确认 modal、关窗守卫）
- Create: `packages/app/src/ui/Modal.tsx`（通用确认弹窗，data-testid="modal"）
- Modify: `packages/app/src/app.css`（tab 栏样式）
- Modify: `electron/shared/channels.ts`（+ `unwatchFile: 'watch:unwatch'`、`closeGuardRequest: 'app:close-guard'`、`confirmClose: 'app:confirm-close'`）
- Modify: `electron/main/ipc.ts`（watcher 升级 `Map<string, FSWatcher>`；watchFile 幂等 add；unwatchFile remove+close；confirmClose handler）
- Modify: `electron/main/index.ts` + `window.ts`（close 守卫：`closeGuardEnabled = process.env.MD_EDITOR_NO_CLOSE_GUARD !== '1'`；close 事件 dirty 时 preventDefault → `webContents.send(CHANNELS.closeGuardRequest)`；confirmClose → 置 allowed 后重新 close）
- Modify: `electron/preload/index.ts` + `packages/app/src/bridge.d.ts` + `packages/app/src/ipc.ts`（unwatchFile / onCloseGuardRequest / confirmClose）
- Modify: `playwright.config.ts`（顶部设 `process.env.MD_EDITOR_NO_CLOSE_GUARD ??= '1'`）
- Test: `packages/app/src/state/appStore.test.ts`（store 逻辑纯测）、`e2e/tabs.spec.ts`

**Interfaces:**

- Produces（后续任务依赖）:
  ```ts
  // appStore
  docs: MdDocument[]; activeDocId: string | null
  openDoc(doc: MdDocument): void            // 同 path 已存在 → 激活不重复开
  closeDoc(id: string): void                // 关活跃 → 激活相邻左侧；空 → null
  setActiveDoc(id: string): void
  // App 渲染派生: const activeDoc = docs.find(d => d.id === activeDocId) ?? null
  // ipc 新增: unwatchFile(path), confirmClose(), onCloseGuardRequest(cb)
  ```

关键实现事实（写死，防止实现者猜测）：

- 主进程 watcher：`const watchers = new Map<string, FSWatcher>()`；`watchFile` 已存在该 path 直接返回；`unwatchFile` 关闭并删除；`dispose` 关闭全部。`createFileWatcher`（watcher.ts）不改。
- onMarkdownChange 里除 `doc.applyEditorMarkdown(markdown)` 外需 `setDirtyTick(t => t + 1)`（MdDocument 可变对象不触发 zustand，脏点靠 tick 重渲染）。
- TabBar：每个 tab `data-testid="tab"`、`data-dirty={doc.isDirty || undefined}`、关闭按钮 `data-testid="tab-close"`；激活 tab `data-active="true"`。
- 标签关闭确认：dirty 时弹 Modal（按钮 `modal-confirm`=放弃更改并关闭 / `modal-cancel`=取消），确认后 `closeDoc` + `ipc.unwatchFile(path)`。
- 窗口关闭确认（无 dirty 时主进程直接放行）：renderer 收到 closeGuardRequest → 无 dirty docs → 立即 `ipc.confirmClose()`；有 dirty → Modal（`modal-confirm`=放弃更改并关闭 / `modal-cancel`=取消）。

- [ ] **Step 1: store 单测先行**（appStore.test.ts）：openDoc 同 path 去重激活、closeDoc 空集与相邻激活、dirty tick 语义纯逻辑断言。跑 `pnpm vitest run packages/app/src/state/appStore.test.ts` 确认失败 → 实现 store → 通过。
- [ ] **Step 2: 主进程/IPC 改造** + `electron/main/ipc.test.ts` 补 unwatchFile 幂等用例（参照现有 watcher.test.ts 风格，chokidar close 断言用注入 stub）。`pnpm vitest run electron/main` 全绿。
- [ ] **Step 3: App 改造 + Modal + CSS**，`pnpm typecheck && pnpm lint` 全过（不得新增告警）。
- [ ] **Step 4: e2e tabs.spec.ts**（launchApp 参照 code-block.spec.ts，`--open` 一文件）：
  1. 打开 workspace（Task 2 前先用 `--open` 打开两文件的方式不可用 → 本用例通过 `app.evaluate` 触发 `webContents.send(CHANNELS.openFile, path2)` 打开第二个文件（evaluate 里 require electron，Playwright 支持）；断言 2 个 tab、第二个激活。
  2. 编辑当前文档（type）→ tab 出现 `data-dirty` + 状态栏「未保存 ·」。
  3. 点该 tab 的 tab-close → modal 出现 → modal-cancel → tab 仍在且 dirty；再点 → modal-confirm → tab 消失，watcher unwatch（改文件无 external-modified 弹出——用第二个 dirty 文档验证可简化为仅 tab 消失断言）。
  4. 关窗守卫：launchApp env 显式 `MD_EDITOR_NO_CLOSE_GUARD: ''`（覆盖全局默认），编辑成 dirty，`app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())` → modal 出现 → modal-cancel → 窗口仍在（断言 window 可见）；modal-confirm → app 进程退出（`app.close()` 前置等待进程事件，用 Playwright `app.waitForEvent('close')` 或轮询 `app.process().killed`）。
- [ ] **Step 5: `pnpm build:app && pnpm e2e` 全量全绿** → commit `feat(app): multi-tab workspace with dirty markers and close confirmation`

### Task 2: 文件树工作区（主进程索引 + 增量推送 + 虚拟滚动）

**Files:**

- Create: `electron/main/workspace.ts`（walk + watcher）
- Test: `electron/main/workspace.test.ts`（walk 结构/过滤/排序 + 10k 文件性能计时）
- Modify: `electron/shared/channels.ts`（+ `openWorkspace: 'workspace:open'`、`workspaceTree: 'workspace:tree'`、`workspaceUpdate: 'workspace:update'`）
- Modify: `electron/main/ipc.ts`（openWorkspace handler：walk → send tree → createWorkspaceWatcher 增量 send；`dispose` 关闭；多次 openWorkspace 关旧开新）
- Modify: `electron/main/index.ts`（CLI `--open-dir <dir>` → did-finish-load 后 send openWorkspace）
- Modify: `electron/preload/index.ts` / `packages/app/src/bridge.d.ts` / `packages/app/src/ipc.ts`（openWorkspace / onWorkspaceTree / onWorkspaceUpdate）
- Create: `packages/app/src/ui/FileTree.tsx` + `packages/app/src/ui/visibleRange.ts`（纯函数）+ 测试 `packages/app/src/ui/visibleRange.test.ts`
- Modify: `packages/app/src/App.tsx`（左侧 sidebar：workspace 打开后渲染 FileTree；点击文件 → openFile；appStore 不动）
- Modify: `packages/app/src/app.css`

**Interfaces:**

- Produces:
  ```ts
  // electron/main/workspace.ts
  export interface WorkspaceNode {
    name: string
    path: string
    type: 'dir' | 'file'
    children?: WorkspaceNode[]
  }
  export async function walkWorkspace(dir: string): Promise<WorkspaceNode[]>
  export interface WorkspaceWatcherOptions {
    dir: string
    onUpdate(update: { added: string[]; removed: string[] }): void
  }
  export async function createWorkspaceWatcher(options: WorkspaceWatcherOptions): Promise<FSWatcher>
  // packages/app/src/ui/visibleRange.ts
  export function visibleRange(
    scrollTop: number,
    viewportHeight: number,
    rowHeight: number,
    total: number,
    overscan?: number,
  ): { start: number; end: number }
  ```
- walk 规则（写死）：`fs.promises.readdir(dir, { withFileTypes: true })` 递归；跳过目录名 `node_modules / .git / out / dist / .svn / .idea`；只收 `.md` / `.markdown` 文件；目录含可显示内容才输出；同级按「目录优先 + localeCompare 排序」；`children` 仅目录节点有。
- 增量事件：chokidar watch(dir, { ignoreInitial: true, ignored: 同上目录正则, depth 不限, awaitWriteFinish 同 M0 })；`add`/`unlink` 只对 `.md/.markdown` 过滤后 100ms 批量合并推送 `{ added, removed }`；目录空了由 renderer 收 removed 后重建树（实现从简：removed 非空时 renderer 重新 `openWorkspace(path)` 拉全量树，避免主进程树 diff）。
- FileTree 虚拟滚动：行高 24px、overscan 8；展开/收起状态 `useState<Map<string, boolean>>`（默认展开）；扁平化函数 `flattenTree(nodes, expanded): { node: WorkspaceNode; depth: number }[]` 放 FileTree 内部；容器 `data-testid="file-tree"`，行 `data-testid="file-row"` + `data-path`；文件行点击调 `ipc.readFile→openFile`（复用 App.openFile）。

- [x] **Step 1: workspace.test.ts 先行**：tmp 目录建结构（含被忽略目录、非 md 文件、子目录）→ walkWorkspace 断言精确结构；`visibleRange.test.ts`：scrollTop=0 / 中段 / 末尾 clamp / total=0。跑确认失败。
- [x] **Step 2: 实现 workspace.ts + visibleRange.ts + FileTree + App 接线 + IPC/CLI**。性能用例：tmp 下生成 10,000 个 .md（先 `Promise.all` 批量写，每批 500），`const t0=performance.now(); await walkWorkspace(dir); expect(performance.now()-t0).toBeLessThan(15_000)`（阈值放宽防 CI 抖动；真实数字进 TODO 验收记录）。跑 `pnpm vitest run electron/main packages/app/src/ui` 全绿。
- [x] **Step 3: typecheck + lint** 全过。
- [x] **Step 4: e2e workspace.spec.ts**：tmp 目录放 `a.md` `sub/b.md` `ignore.txt`；launch args `['.', '--open-dir', dir, '--open', someFile]`；断言：file-tree 可见且不含 `ignore.txt`；点击 `a.md` 行 → 打开新 tab（承接 Task 1）激活；外部 `writeFileSync(dir, 'c.md')` → 1s 内出现 `c.md` 行（增量 add）；删除 `c.md` → 行消失（removed → 全量重建）。
- [x] **Step 5: 全量门禁 + commit** `feat(app): workspace file tree with incremental watcher and virtual scroll`

### Task 3: 大纲面板（parseOutline + 光标跟随）

**Files:**

- Create: `packages/editor/src/outline.ts`（parseOutline）+ `packages/editor/src/outline.test.ts`
- Create: `packages/editor/src/cursor-notify.ts`（EditorHost 用 PM 插件工厂）+ `packages/editor/src/cursor-notify.test.ts`
- Modify: `packages/editor/src/index.ts`（导出 parseOutline、OutlineItem、createCursorNotifyPlugin）
- Modify: `packages/editor/src/EditorHost.tsx`（props + `getBufferText?: () => string`、`onCursorChange?: (offset: number) => void`；`.use` 前经 `prosePluginsCtx` 注册插件——EditorHost 已 import prosePluginsCtx；插件内 150ms 节流 + `pmPosToMarkdownOffset(buffer, view.state.doc, anchor)`）
- Modify: `packages/editor/src/source-editor.tsx`（同 props；CM updateListener selection 变化 → handle.getSelectionOffsets() 直接回传，无需映射）
- Modify: `packages/app/src/App.tsx`（右/左 sidebar 大纲面板组件内联或 `packages/app/src/ui/OutlinePanel.tsx`；cursorOffset state 200ms throttle；点击项 → activeHandle.setSelectionOffsets(item.textOffset, item.textOffset) + focus）
- Modify: `packages/app/src/app.css`
- Test: `packages/editor/src/outline.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export interface OutlineItem {
    level: number
    text: string
    offset: number
    textOffset: number
  }
  // offset = 标题行 mdast position.start.offset（含 '# ' 标记），textOffset = 文本起点（offset + level + 1，ATX）
  export function parseOutline(markdown: string): OutlineItem[]
  export function createCursorNotifyPlugin(
    getNotify: () => { cb: ((offset: number) => void) | null; buffer: string } | null,
  ): Plugin
  ```
- parseOutline 规则（写死）：`unified().use(remarkParse).use(remarkGfm)`（与 cursor-map 同管线）遍历 **root 顶层 children**（引述/列表内的标题不算）；ATX 与 setext 均收（setext textOffset = position.start.offset，offset 同）；fenced code 内 `#` 不算（remark 自动）；text 取 children 纯文本拼接（沿用 mdast text 拼接：递归取 text 节点 value，inline code 取 value 原样）。
- 高亮语义：`active = 最后一个满足 cursorOffset >= item.offset 的项`；点击定位后由 onCursorChange 自然刷新。

- [ ] **Step 1: outline.test.ts 先行**（jsdom 不需要，纯函数）：
  - `'# T1\n\ntext\n\n## Sub\n\n### Deep\n'` → 3 项，level/text/offset/textOffset 精确 toBe（T1: {1,'T1',0,2}；Sub: {2,'Sub',11,14}——以真实 remark position 为准，跑一次打印校准后写死）；
  - setext：`'Title\n=====\n'` → {1,'Title',0,0}；
  - fenced code 内 `# not-heading` 不出现；`> # quoted` 不出现；
  - 空串 → []；inline code/加粗标题文本拼接正确。
    跑确认失败 → 实现 → 全绿。
- [ ] **Step 2: cursor-notify.test.ts 先行**（jsdom + createTestEditor）：`createTestEditor('# H\n\npara\n', [], [])`，手动把 plugin 加进 prosePluginsCtx（create-test-editor 第三参为 MilkdownPlugin[]，用 $prose 包装的工厂不方便直加 → 测试直接 `new Plugin` 同构注入或 expose 工厂返回的 Plugin；实现从测试可达出发：工厂返回 `Plugin`，测试 `createTestEditor(md, [plugin], [])`）→ dispatch TextSelection 到 'para' 内 → 断言 cb 收到 md offset（'para' 的 p 起点偏移，精确值跑后写死）→ 150ms 内第二次变化不重复发射（节流）。
- [ ] **Step 3: 实现 cursor-notify.ts + EditorHost/SourceEditor 接线 + App 大纲面板 + CSS**。`pnpm typecheck && pnpm lint` 全过。
- [ ] **Step 4: e2e outline.spec.ts**：fixture `# A\n\npara\n\n## B\n\nbody\n`；等 ready；断言 2 个 outline 行（`data-testid="outline-item"`）；点击 B 项 → `__mdEditorDebug.pmSelection()` 返回 anchor 落在 B 标题（用 offset→pm pos 校验：pmSelection.anchor 在 B 行文本 pos ±1 内，参考 table.spec 的状态真值断言方式）；把光标点进 'body'（点击该段）→ 等待 400ms → B 项带 `data-active="true"`（跟随高亮）。
- [ ] **Step 5: 全量门禁 + commit** `feat(editor): outline panel with remark parse and cursor tracking`

### Task 4: 查找替换（Buffer 级）

**Files:**

- Create: `packages/app/src/find/finder.ts` + `packages/app/src/find/finder.test.ts`
- Create: `packages/app/src/ui/FindReplacePanel.tsx`
- Modify: `packages/app/src/App.tsx`（Ctrl+F capture 拦截开面板（同 Ctrl+/ 方式）；面板状态；匹配导航 setSelectionOffsets；Replace/Replace All → `activeDoc.replaceText` + reloadToken++ + dirtyTick++）
- Modify: `packages/app/src/app.css`

**Interfaces:**

- Produces:
  ```ts
  export interface FindOptions {
    caseSensitive: boolean
    wholeWord: boolean
    regex: boolean
  }
  export function computeMatches(
    text: string,
    query: string,
    options: FindOptions,
  ): Array<{ from: number; to: number }>
  // query 空 / regex 非法 → []；wholeWord 用 \b 包裹（仅非 regex）；非 regex 时 query 按 String.raw 转义
  ```
- 替换语义（写死）：单个 Replace = `activeDoc.replaceText({from, to}, replacement)`（regex 时 replacement 支持 `$1`，由 `text.slice(from,to).replace(matchRegex, replacement)` 产出）；Replace All = 构造整段新文本后单次 `replaceText({from:0,to:text.length}, nextText)`（regex 非法/无匹配 → 状态栏提示不写）；每次替换后 `setReloadToken(t=>t+1)` 触发编辑器重挂载（会话撤销栈自动恢复撤销链，ADR-6 的单事务语义在 Buffer 层由单次 replaceText 等价满足——**在 component-api.md 登记该偏离**：PM ReplaceStep 改为 Buffer replaceText，理由：双模式一致 + 会话恢复已有兜底）。
- UI data-testid：`find-panel`、`find-input`、`find-count`、`find-prev`、`find-next`、`find-case`、`find-word`、`find-regex`、`find-replace`、`find-replace-all`、`find-replace-input`、`find-close`；Esc 关闭（window capture keydown）。
- 计数规则：matches 为空 → `0 个结果`；当前项从 0 开始，Enter/find-next 循环前进并 setSelectionOffsets(from,to)。

- [ ] **Step 1: finder.test.ts 先行**（≥8 用例）：普通/大小写开关/全词边界（`cat` 不匹配 `category`）/正则分组（`\d+`、`(\w)-(\w)` + `$1_$2` 替换预期串）/非法 regex → [] /空 query → [] /重叠匹配不重叠取（`aaa` 搜 `aa` → 1 个）/偏移精确性。失败 → 实现 → 全绿。
- [ ] **Step 2: FindReplacePanel + App 接线 + CSS**。typecheck/lint 全过。
- [ ] **Step 3: e2e find-replace.spec.ts**：fixture `'alpha beta\ngamma alpha\n'`；Ctrl+F → 输入 alpha → `2 个结果`；find-next → pmSelection anchor 在第一处 alpha；再次 find-next → 第二处（跨行）；打开 `find-replace-input` 输入 `omega` → find-replace → 600ms 后 `__mdEditorDebug.getMarkdown()` === `'omega beta\ngamma alpha\n'`；find-replace-all → === `'omega beta\ngamma omega\n'`；正则开关 + `(\w+) (\w+)` → `$2 $1` 全替换 → 断言对应结果；Ctrl+S 后磁盘 === 期望串。
- [ ] **Step 4: 全量门禁 + commit** `feat(app): find and replace with regex, case and whole-word over buffer`

### Task 5: 外部修改二选一弹窗

**Files:**

- Modify: `packages/app/src/App.tsx`（externalNotice 流程升级：dirty 时 `pendingExternalPath` state + Modal：`modal-confirm`=重载（丢弃我的） / `modal-cancel`=保留我的；保留 → `setExternalNotice('已保留我的修改；请尽快另存或关闭该文件')`；重载 → 读盘 setExternalText + reloadToken++）
- Test: `e2e/external-choice.spec.ts`（新建；external-change.spec.ts 不动——e2e 只加不删）

- [ ] **Step 1: e2e 先行**：launch --open file；type 编辑成 dirty；外部 `writeFileSync(file, '# external\n')`；断言 modal 出现（`data-testid="modal"`）+ 文案含「重载」「保留」；点 modal-cancel → 编辑内容仍在（getMarkdown 含用户文本）且状态含「已保留我的修改」；再次外部写 → modal-confirm → getMarkdown === `'# external\n'` + reloadToken 重挂载后 still exact。
- [ ] **Step 2: 实现**（无外部依赖改动，纯 App 层）。typecheck/lint/test 全绿。
- [ ] **Step 3: 全量门禁 + commit** `feat(app): external modification reload or keep choice dialog`

### Task 6: 会话恢复（ADR-7）

**Files:**

- Create: `electron/main/session.ts`（save/load）+ `electron/main/session.test.ts`
- Modify: `electron/shared/channels.ts`（+ `sessionSave: 'session:save'`、`sessionLoad: 'session:load'`）
- Modify: `electron/main/ipc.ts`（sessionSave：payload 长度守卫 ≤ 5MB + `writeAtomic(join(app.getPath('userData'), 'session.json'), …)`；sessionLoad：读不到/解析失败 → null）
- Modify: `electron/main/ipc.ts` appInfo handler 返回 `{ version, electron, hasCliOpen: boolean }`（main index 把 `openPathFromCli() !== null` 传入 registerIpc）
- Modify: `electron/preload/index.ts` / `bridge.d.ts`（preload 与 app 各自 AppInfo 类型加 `hasCliOpen`） / `packages/app/src/ipc.ts`
- Modify: `packages/app/src/document/MdDocument.ts`（`MdDocumentInit` 加可选 `dirty?: boolean`；构造读取；MdDocument.test.ts 补用例：dirty 初始 → bytesForSave 非 null 且内容正确）
- Modify: `packages/app/src/App.tsx`（5s interval：存在 dirty doc → `ipc.saveSession(JSON.stringify({ version: 1, savedAt, activePath, tabs: docs.map(d => ({ path: d.path, dirty: d.isDirty, text: d.text })) }))`；mount 时 `getAppInfo().hasCliOpen === false` → `ipc.loadSession()` → 逐 tab：readFile 成功 → openDoc（dirty && text 存在 → MdDocument init 用 snapshot text + dirty: true；文件不存在 → 跳过该 tab）；watchFile 每个 tab）
- Test: `e2e/session-recovery.spec.ts`

- [ ] **Step 1: session.test.ts 先行**：save 写 tmp（注入 path 参数：`saveSession(json, filePath)` / `loadSession(filePath)`，ipc 层传 userData 路径——保持纯测可行）；load 缺失 → null；损坏 JSON → null；>5MB → throw。跑确认失败 → 实现 → 全绿。
- [ ] **Step 2: MdDocument dirty init 用例 + 实现**。全绿。
- [ ] **Step 3: App/main/preload 接线**。typecheck/lint/test 全绿。
- [ ] **Step 4: e2e session-recovery.spec.ts**：launch `--open file`（userData 固定目录）；编辑 type 追加文本成 dirty；等 6s（快照写入）；`app.close()`；同 userData 再 launch（**不带 --open**）→ 等 ready → 断言 1 个 tab 恢复、getMarkdown === 编辑后文本、状态含「未保存」。
- [ ] **Step 5: 全量门禁 + commit** `feat(app): crash session recovery via appdata snapshot`

### Task 7: 文档登记 + 全量门禁 + Ledger

**Files:** `component-api.md`（outline / cursor-notify / finder / appStore tabs / 新 IPC 通道清单）、`TODO.md`（M3 各项置 [x] + 验收数字）、`development.md`（如新增命令无则只补 R1 相关说明：查找替换偏离 ADR-6 的登记已在 component-api，development 6 节追加引用行）、本计划 Ledger。

- [ ] **Step 1: 文档编辑**（对照 AGENTS 跨文档事实速查；性能验收「10k 索引 <3s」写 Task 2 实测真实值）
- [ ] **Step 2: 全量门禁**：`pnpm typecheck` → `pnpm lint` → `pnpm test` → `pnpm build:app` → `pnpm e2e` 全绿，数字入 TODO。
- [ ] **Step 3: commit** `docs: register m3 workbench in api and todo`
- [ ] **Step 4: Ledger 追加**（每任务 commit + review 结论 + Ruling）。

- Task 4: review complete（inline fallback）— Ruling: 子代理服务 503 不可用，Task 4 评审由主会话 inline 执行（findings：无 Important；Minor：Escape 全局拦截在 modal 打开时也会收起 find 面板，无实际危害）。实测 unit 234/234、source-mode e2e 3/3（R3 回归）、find-replace e2e 1/1。

## Self-Review

- 覆盖检查：TODO M3 六项 → Task 1（标签/脏/关确认）、Task 2（文件树）、Task 3（大纲）、Task 4（查找替换）、Task 6（会话恢复）、Task 5（外部二选一）；P2 文件树增删改 = v1.1 明确不做；验收「10k<3s」→ Task 2 性能用例 + TODO 实测；「万行滚动」→ 编辑器已惰性渲染为 v1.1 口径，M3 不加卡顿断言（登记说明）。
- 占位符扫描：唯一「跑后写死」处（Task 3 步骤 1 的 remark 精确偏移、Task 1 步骤 4 的 PM pos）均为实测校准指令而非占位——与 M2 计划先例一致（计划值需以真实 remark/PM 结构为准）。
- 类型一致性：OpenDoc/closeDoc/unwatchFile、WorkspaceNode/visibleRange、OutlineItem、computeMatches、hasCliOpen 各任务间签名一致；CHANNELS 增量清单唯一。

## Ledger（subagent-driven 执行记录）

- Task 1: complete — commit fc134cd — review fix round 1（见下行）。偏离：关窗守卫退出路径经 `before-quit` → `markQuitting()` 旁路（app.quit 不被守卫拦截）；e2e evaluate 用字面量 `'app:open-file'`（Playwright evaluate 序列化不携带模块引用）。

- Task 2: complete — commit cd6113a — walk（忽略目录/md 过滤/目录优先排序）+ chokidar 100ms 批量 add/unlink + FileTree 虚拟滚动（24px/overscan 8）+ IPC 三处 + --open-dir；10k 文件 walk 实测 32.8ms（阈值 15s）；全量 test 209 passed / typecheck / lint / e2e 38 passed 全绿。偏离：无（added 走渲染进程插入节点，removed 走全量重拉，均按计划语义）。

- Task 3: complete — commit 889a8f4 — parseOutline（remark root 顶层，ATX/setext，精确 offset 经真实 position 校准）+ cursor-notify 插件（150ms leading/trailing 节流，pmPosToMarkdownOffset 投影）+ EditorHost（prosePluginsCtx 注册）与 SourceEditor（updateListener 直接回传）接线 + App OutlinePanel（200ms 节流高亮 data-active）+ e2e outline.spec.ts；全量 test 220 passed / typecheck / lint / e2e 39 passed 全绿。偏离：SourceEditor 未用 getBufferText（CM anchor 已是 md offset，契约保留）；cursor-notify 测试需先跨过编辑器创建时事务的节流窗口再断言增量。
- fix round 1: 评审 4 findings — 1 Important 已修（appStore closeDoc 关中间活跃 tab 改激活左邻 index-1，appStore.test.ts 补中间位置用例）；2 Minor 已修（ipc watchFile/unwatchFile 入参 path 非 string/空串干净拒绝 `invalid path` + 单测）；1 Minor parked finding（后台 tab 外部修改事件不分叉处理，仅活跃 tab 生效）留给 Task 5 一并处理。

- Task 4: complete — commit 4db76bf — finder.ts（computeMatches/buildReplacedText/compileFindRegex，13 单测：大小写/全词边界/正则分组 $1/非法 regex/空 query/重叠不重叠取/偏移精确/零长跳过）+ FindReplacePanel（data-testid 全表，计数「N 个结果」，当前项从 0 循环）+ App 接线（Ctrl+F capture、Esc、导航 setSelectionOffsets、Replace/Replace All → replaceText + reloadToken/dirtyTick，handle 经 ref 取最新）+ e2e find-replace.spec.ts（count/跨行导航 pmSelection 真值/单替换/全替换/正则 $2 $1/Ctrl+S 落盘）；全量 test 234 passed / typecheck / lint / e2e 40 passed 全绿。偏离：发现并修复 cursor-map 软换行缺陷（mdast 单 text 含 \n vs PM text+hardbreak+text 配对失败整段 fallback → flattenInline 切分 text 插伪 break 叶子，新增回归用例；R3 source-mode e2e 全绿）；ADR-6 偏离（PM ReplaceStep → Buffer 单次 replaceText + reloadToken 重挂载）已登记 component-api.md 4.0 节。
- Task 5: complete — commit d7c5440 — dirty 外部修改二选一 Modal（pendingExternalPath state，与 pendingClose 互斥：单 Modal 三元渲染）；保留 = setExternalNotice/setStatus 固定文案；重载 = readFile + setExternalText + reloadToken++。偏离：新增 editor 包一行导出 clearHistory（已有 API 未导出），外部重载前清会话撤销栈——否则 session-history 按 docId 重放旧会话事务，把保留内容复活进新编辑器（e2e 实测暴露）；重载路径新增 setStatus 与保留路径对齐状态栏口径。全量 test 234 passed / typecheck / lint / build:app / e2e 41 passed 全绿。

- Task 6: complete — commit b1c2480 — session.ts save/load（路径注入纯测 4 例：往返/缺失 null/损坏 null/>5MB throw，writeAtomic 落盘）+ MdDocument dirty?: boolean init（snapshot text + 磁盘 originalBytes，1 例）+ 接线 CHANNELS sessionSave/sessionLoad、appInfo hasCliOpen（registerIpc 第三参）、preload/bridge/ipc 三处、App 5s interval（仅 dirty 时快照，卸载 clearInterval）+ mount hasCliOpen===false → loadSession → 逐 tab readFile 缺失跳过 / openDoc 去重 / watchFile；e2e session-recovery.spec.ts（固定 userData、6s 快照、close 重启恢复 1 tab + getMarkdown 真值 + 未保存状态）。全量 test 239 passed / typecheck / lint / e2e 42 passed 全绿。偏离：快照 tabs 过滤 path=null 的未命名文档（SessionTabSnapshot.path 类型为 string，restore 语义不受影响）；e2e 期望值由「段末换行追加」改为实际键入语义 originalrecovered（非删断言）。
- fix round 1 (Task 6): Ruling-7/8 已修 — commit a296309 + 16fb909。Ruling-7：快照失效语义落地 — removeSession IPC（fs.rm force no-op，CHANNELS +1 四处同步）+ App 三触发（interval 全库转干净 ref 门控 / 保存 markSaved 后 / closeDoc 含放弃更改后）+ session.test 2 例 + e2e 放弃关闭 → 重启 0 tab 恢复。Ruling-8 定位结论：测试竞态（非产品 bug）——重挂载后旧闭包 hook 指向已 destroy 的 editor（editorViewCtx not found），expect.poll 遇 throw 直接失败；hook 本身会重绑（多数轮次通过 + 单跑通过）。修法：e2e readMarkdown 捕获 throw 返回 null 让 poll 重试（等待加固，断言语义未放宽），连跑 3 次全绿。Minor：restore 按 snapshot.activePath 激活对应 tab。门禁：unit 241/241 / typecheck / lint / e2e 43/43 全绿。偏离：无。
