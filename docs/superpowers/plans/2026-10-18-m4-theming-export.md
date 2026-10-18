# M4 主题与导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 M4 —— 内置 3 主题的主题系统、settings.json 设置中心、PDF（printToPDF）与自包含 HTML 导出、theme:check 校验、原生菜单（F11 全屏双通道 + 退出守卫）、新建未命名笔记 + 另存为。

**Architecture:** 主进程新增 `menu.ts`（原生菜单/快捷键）、`settings.ts`（appdata settings.json 读写）、`exporter.ts`（printToPDF + 保存对话框）；preload 契约追加窄接口；`packages/theming` 提供主题 CSS 变量表与主题切换；`packages/export` 提供自包含 HTML 组装；`packages/app` 提供设置面板与导出/新建菜单响应。Buffer 仍是唯一事实源，渲染进程无 Node 权限。

**Tech Stack:** Electron 44 (`Menu`/`dialog`/`webContents.printToPDF`)、React 18、TypeScript、Vitest、Playwright `_electron`。

**Spec:** `architecture.md`（2.1/2.2/2.3、ADR-3/4/7）、`TODO.md` M4 节、`development.md` 6 节回归清单、`component-api.md`。

## Global Constraints

- 渲染进程禁止 Node/fs；新 IPC 全部走 `electron/preload` 窄接口 + `shared/channels.ts` 白名单。
- `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` 不得回退。
- 主题只允许 CSS 变量；主题 id 固定为 `github-light` / `github-dark` / `paper-serif`。
- 零编辑保存不写盘；导出不改 Buffer、不标脏。
- 每个任务提交前必须 `pnpm lint && pnpm typecheck && pnpm test` 全绿；涉及 e2e 的任务加跑 `pnpm e2e`。
- 提交信息英文祈使句 + scope（如 `feat(menu): add native menu with F11 fullscreen`）。
- 人工验证项（原生菜单 F11 进出、新建→另存为落盘、PDF 中文字体分页、HTML 离线打开）登记后置，不阻塞开发。

---

### Task 1: settings.json 主进程读写 + IPC

**Files:**

- Create: `electron/main/settings.ts`, `electron/main/settings.test.ts`
- Modify: `electron/shared/channels.ts`, `electron/main/ipc.ts`, `electron/preload/index.ts`
- Test: `electron/main/settings.test.ts`, `electron/main/ipc.test.ts`

**Interfaces:**

- Produces: `loadSettings(): AppSettings`、`saveSettings(s: AppSettings): void`；settings.json 位于 `app.getPath('userData')/settings.json`；损坏 JSON 回退默认值。
- Produces: preload `getSettings(): Promise<AppSettings>`、`setSettings(next: AppSettings): Promise<AppSettings>`（主进程合并校验后返回生效值并广播 `settingsChanged`）。

- [ ] Step 1: 先写失败测试 —— 默认值 `{ themeId: 'github-light', export: { pdf: { printBackground: true } } }`；写后读回一致；损坏 JSON 返回默认值且不抛错；`setSettings` 合并未知字段为白名单内字段。
- [ ] Step 2: `pnpm test electron/main/settings.test.ts` 确认 FAIL。
- [ ] Step 3: 实现 `settings.ts`（同步原子写：tmp→rename；字段白名单 merge）并接通 `CHANNELS.settingsGet/settingsSet` + preload。
- [ ] Step 4: `pnpm test` 全绿，`pnpm lint && pnpm typecheck` 通过。
- [ ] Step 5: Commit `feat(settings): persist app settings with whitelist merge`

### Task 2: theming 包 —— 3 主题 CSS 变量 + 切换器

**Files:**

- Create: `packages/theming/src/themes.ts`（主题变量表）、`packages/theming/src/apply.ts`、`packages/theming/src/themes.test.ts`、三个主题 CSS：`packages/theming/src/themes/github-light.css` / `github-dark.css` / `paper-serif.css`
- Modify: `packages/theming/package.json`（exports）、`packages/app/src/app.css`（消费变量）

**Interfaces:**

- Produces: `type ThemeId = 'github-light' | 'github-dark' | 'paper-serif'`；`THEMES: Record<ThemeId, ThemeVars>`；`applyTheme(id: ThemeId): void`（把变量写到 `document.documentElement.style`，供设置面板与 e2e 使用；e2e 断言 `data-theme` 属性）。

- [ ] Step 1: 先写失败测试：三主题 id 完整、变量键集合一致（同一组 CSS 变量名，值不同）、`applyTheme` 在 jsdom 下设置 `data-theme` 与至少 `--md-bg`/`--md-fg`/`--md-accent`。
- [ ] Step 2: 跑测确认 FAIL，实现变量表与 `applyTheme`。
- [ ] Step 3: `packages/app` 在启动时读 settings.themeId 并 `applyTheme`，监听 `settingsChanged`。
- [ ] Step 4: 门槛全绿 + Commit `feat(theming): add builtin themes and theme applier`

### Task 3: 设置中心 UI 面板

**Files:**

- Create: `packages/app/src/ui/SettingsPanel.tsx`, `packages/app/src/ui/SettingsPanel.test.tsx`
- Modify: `packages/app/src/App.tsx`（齿轮入口 + 弹层）、`packages/app/src/state`（settings store）、`packages/app/src/bridge.d.ts`

**Interfaces:**

- Consumes: Task 1 的 `getSettings/setSettings`，Task 2 的 `applyTheme`。
- Produces: 设置面板含主题选择（3 主题单选）与导出选项占位；切换主题立即 `applyTheme` + `setSettings`。

- [ ] Step 1: 失败测试：打开面板 → 选择 `github-dark` → `applyTheme` 被调用且 `setSettings` 收到 `{ themeId: 'github-dark' }`。
- [ ] Step 2: 实现面板（轻量弹层，沿用 M3 对话框样式）。
- [ ] Step 3: 门槛全绿 + e2e 新增 1 例：`e2e/settings.spec.ts` 打开面板切主题，断言 `document.documentElement.dataset.theme` 变化（只断言 DOM 主题属性，非编辑器选区）。
- [ ] Step 4: Commit `feat(app): add settings panel with theme picker`

### Task 4: 原生菜单 + F11 全屏 + 退出守卫接线（人工验证后置）

**Files:**

- Create: `electron/main/menu.ts`, `electron/main/menu.test.ts`
- Modify: `electron/main/index.ts`（`Menu.setApplicationMenu`）、`electron/main/window.ts`、`electron/shared/channels.ts`

**Interfaces:**

- Produces: 菜单结构 —— 文件（新建 Ctrl+N、打开 Ctrl+O、另存为 Shift+Ctrl+S、导出 PDF Ctrl+Shift+P）、编辑、视图（全屏 F11 toggleFullscreen、源码模式 Ctrl+/ 统一进全局快捷键注册表）、帮助。
- Produces: F11 双通道 = 菜单 accelerator + renderer keydown 都调 `win.setFullScreen(!isFullScreen())`（幂等）；菜单「退出」走 `app.quit()`，`close` 事件仍触发 dirty 守卫（`markQuitting` 只在 `before-quit` 置位，且脏 Buffer 时 renderer 先走守卫——沿用现有 confirmClose 流程）。
- Produces: `onMenuCommand(handler: (cmd: 'new-note'|'save-as'|'export-pdf') => void)` preload 通道。

- [ ] Step 1: 失败测试：菜单模板含 F11（role/accelerator）、`toggleFullscreen(win)` 幂等；`buildTemplate(deps)` 对 new-note/save-as/export-pdf 调用注入的 handler。
- [ ] Step 2: 实现 menu.ts 并接入 index.ts / window.ts；renderer F11 keydown 在 `packages/app` 增加（调用 preload `toggleFullscreen()`）。
- [ ] Step 3: e2e 1 例：`e2e/menu.spec.ts` 断言菜单已设置（`Menu.getApplicationMenu()` 经主进程测试或 evaluate 可得），全屏切换用 `win.setFullScreen` 状态真值。人工 F11 手测登记到 TODO 验收，后置。
- [ ] Step 4: 门槛全绿 + Commit `feat(menu): add native menu with F11 fullscreen and command channels`

### Task 5: 新建未命名笔记 + 另存为 Save As

**Files:**

- Create: `electron/main/dialogs.ts`, `electron/main/dialogs.test.ts`
- Modify: `electron/shared/channels.ts`, `electron/main/ipc.ts`, `electron/preload/index.ts`（`showSaveDialog(defaultName): Promise<string|null>`）、`packages/app` 文档状态（无路径 tab：`path=null`，标题「未命名.md」，Ctrl+S 自动转另存为）

**Interfaces:**

- Consumes: Task 4 的 `onMenuCommand('new-note'|'save-as')`。
- Produces: 主进程 `dialog.showSaveDialog({ defaultPath: <userData>/未命名.md, filters: [{name:'Markdown', extensions:['md','markdown']}] })` 返回选中路径；渲染层拿到路径后按现有 `writeFile` 流程落盘并取得写入凭证（复用 M0 逻辑，不重写 IO）。

- [ ] Step 1: 失败测试（dialogs.test.ts，mock dialog）：默认名 `未命名.md`、用户取消返回 null、路径透传。
- [ ] Step 2: 实现；App 侧新建 tab（path=null）、save-as 命令保存无路径或指定 tab。
- [ ] Step 3: e2e 1 例：mock dialog 或直接测 renderer「无路径 Ctrl+S 弹另存为」逻辑单测；e2e 至少覆盖新建 tab 出现且零编辑保存不写盘路径不变。人工「新建→另存为落盘」登记后置。
- [ ] Step 4: 门槛全绿 + Commit `feat(app): new untitled note and save as via native dialog`

### Task 6: PDF 导出（printToPDF）

**Files:**

- Create: `electron/main/exporter.ts`, `electron/main/exporter.test.ts`
- Modify: `electron/shared/channels.ts`, `electron/main/ipc.ts`, `electron/preload/index.ts`（`exportPdf(html?): Promise<string>`），`packages/export`（`exportPdf()` 调用桥）、`packages/app` 菜单命令接线

**Interfaces:**

- Consumes: Task 5 的保存对话框（导出 PDF 先弹 save dialog 选目标路径）。
- Produces: 主进程 `printToPDF({ printBackground: true, margins: { top:0.4,bottom:0.4,left:0.4,right:0.4 } })`，写入用户选择路径（原子写），返回路径；渲染侧导出前用当前 Buffer 的渲染 HTML 组装临时文档（Task 7 的 HTML 管线复用同一函数）。

- [ ] Step 1: 失败测试：mock `webContents.printToPDF` 返回 Buffer → 写入指定路径；用户取消不打印不写盘；`printBackground` 取自 settings。
- [ ] Step 2: 实现 exporter.ts（含 CSP 安全的临时 loadURL/loadFile 方案：`data:` URL 或 `loadURL('data:text/html...')`，禁止远程脚本）。
- [ ] Step 3: e2e 冒烟沿用 M0 PDF 用例模式扩展：导出产生 .pdf 且字节数 > 0（人工中文字体/分页验证登记后置）。
- [ ] Step 4: 门槛全绿 + Commit `feat(export): silent pdf export via printToPDF`

### Task 7: 自包含 HTML 导出

**Files:**

- Create: `packages/export/src/html.ts`, `packages/export/src/html.test.ts`
- Modify: `packages/export/package.json`, `packages/app` 导出入口（PDF 复用 `buildStandaloneHtml` 产出）

**Interfaces:**

- Produces: `buildStandaloneHtml(buffer: string, opts: { themeCss: string; inlineImages: boolean; title: string }): Promise<string>` —— Markdown→HTML 用 Milkdown 同源 remark 管线（在 export 包内直接用 `unified/remark-parse/remark-rehype/rehype-stringify` + GFM 扩展，属大纲/索引同栈，不是新编辑内核）；`inlineImages=true` 时把本地相对路径图片转 base64（经 preload 读文件），远程 http(s) 图片保持链接。

- [ ] Step 1: 失败测试：标题/代码/表格转换；主题 CSS 内联进 `<style>`；`inlineImages` 相对路径图片被替换为 `data:image/...;base64`；CSP meta 无脚本。
- [ ] Step 2: 实现并接入 App「导出 HTML」菜单/命令 + save dialog。
- [ ] Step 3: e2e 1 例：导出 HTML 后读回文件含 `<style>` 与渲染内容标记。人工离线打开验证后置。
- [ ] Step 4: 门槛全绿 + Commit `feat(export): self-contained html export`

### Task 8: theme:check 校验脚本

**Files:**

- Modify: `scripts/theme-check.mjs`, `package.json`（如需依赖）
- Create: `scripts/theme-check.test.mjs`（或 vitest 单测 `scripts/theme-check.test.ts`）

**Interfaces:**

- Consumes: Task 2 的 THEMES 变量表。
- Produces: 校验三主题变量键集合一致、必需变量存在（`--md-bg/--md-fg/--md-accent/--md-border/--md-code-bg` 等）、无硬编码颜色出现在主题 CSS 之外的核心样式、退出码 0/1。

- [ ] Step 1: 失败测试：缺失变量报错、键不一致报错、通过场景 exit 0。
- [ ] Step 2: 实现；`pnpm theme:check` 全绿并加入 CI 脚本链（lint 后追加）。
- [ ] Step 3: Commit `feat(theming): implement theme check script`

### Task 9: 文档与验收收口

**Files:**

- Modify: `TODO.md`（M4 各项勾选 + 人工验证待办登记）、`development.md` 6 节 R 清单勾选、`component-api.md`（新 IPC 契约与导出接口）

- [ ] Step 1: 全量门槛 `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e && pnpm theme:check` 全绿并记录关键数字。
- [ ] Step 2: 更新三份文档 + Commit `docs: record m4 delivery and pending manual tests`

---

## 人工验证清单（后置，不阻塞合入）

1. 原生菜单 F11 全屏进出 + 菜单通道一致；脏文档退出守卫仍触发。
2. 新建未命名笔记 → 另存为落盘、标题更新。
3. 导出 PDF：中文分页与字体正常。
4. 导出 HTML：断网双击打开样式完整。
