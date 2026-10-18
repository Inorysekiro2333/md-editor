# md-editor 交接文档：M4 完成 → M5 启动（2026-10-18）

> 用途：新对话/新会话接手 md-editor 开发时的完整上下文。先读 AGENTS.md（含「CI / E2E 教训」「AI 执行效率规范」两节），再读本文。上一份交接见 `docs/superpowers/handoffs/2026-10-18-m3-done-m4-start.md`；M4 的完整计划与执行记录见 `docs/superpowers/plans/2026-10-18-m4-theming-export.md`。

## 1. 当前状态（一句话）

M0–M4 全部完成并合入 main（HEAD `1995cb5`，PR #3）；**M5（发布打磨）未开工**。CI 于 PR 合并时全绿（本地门禁：lint / typecheck 5 个 tsconfig / test 327 passed (38 files) / e2e 49 passed / theme:check 通过）。M4 人工验证 2026-10-18 全部通过（F11+退出守卫、另存为真实对话框、PDF 中文字体分页、HTML 断网离线打开）。

## 2. M4 交付关键事实（接手者必须知道）

### 主题与设置（packages/theming、electron/shared|main/settings.ts、packages/app/ui/SettingsPanel.tsx）

- 主题 = CSS 变量表（`THEME_VARIABLES` 统一键集合，含 `--md-font-serif`）+ `applyTheme`（写 root style + `data-theme` 属性）+ `themeCss(id)`（导出用 CSS 生成，packages/theming/src/css.ts）。App 消费 `--bg/--fg/--code-bg` 别名。
- settings.json 存 `userData/`，白名单 merge（非法 themeId/printBackground 回退默认，损坏 JSON 回退默认不抛错）；settingsSet 落盘后广播 `settingsChanged`，面板乐观更新、App 广播驱动 applyTheme（无双写）。
- `scripts/theme-check.mjs` 从 themes.ts 提取单一事实源校验三主题键集合 + app.css 硬编码颜色（9 条豁免见 `CORE_CSS_EXEMPTIONS`，待 `--md-fg-muted` 等别名落地后迁移）。

### 导出（electron/main/exporter.ts、packages/export/src）

- PDF 与 HTML 共用 `buildStandaloneHtml(buffer, opts)`（remark 同栈管线，CSP 禁脚本 meta，禁止远程脚本）；PDF：隐藏 BrowserWindow（三安全开关显式）+ userData/tmp 临时 .html + `loadFile`，用后 `fs.rm`（勿回退 data: URL——2MB 上限陷阱已记录于 component-api.md §5）。
- HTML 导出：`asset:read` 窄 IPC（扩展名白名单 + 拒绝绝对路径/协议 URL）把相对路径图片内联 base64；远程 http(s) 图保持外链；`EXPORT_HTML_MAX_BYTES`（50MB）超限干净报错。
- 导出不改 Buffer、不标脏；写盘一律 `writeAtomic`。

### 原生菜单 / 文件（electron/main/menu.ts、dialogs.ts；packages/app/ui/useCaptureKeydown.ts）

- `MenuCommand = 'new-note' | 'open' | 'save-as' | 'export-pdf' | 'export-html'`；全部经 `onMenuCommand` 单通道，renderer 逐个消费。**Ctrl+/ 刻意未进菜单**（防与 renderer capture 抢键，统一注册表仍挂持续性任务）。
- F11 只保留菜单 accelerator 一个通道（`toggleFullscreen` 幂等）；勿再在 renderer 加 keydown——曾因双通道出现全屏闪烁死循环。
- `useCaptureKeydown`：add/remove 必须同 capture 标志。此前 App.tsx 直接 addEventListener 泄漏监听器 → 一次 Ctrl+S 双弹对话框 + 并发写同一 `.tmp`（Windows rename sharing violation 报「保存失败」）。新键盘快捷键一律走该 hook。
- 未命名 tab：`path=null`，标题「未命名.md」，Ctrl+S 自动转另存为；另存 = 显式落盘意图，零编辑也产出字节（`bytesForSaveAs`）。

### 粘贴图片与编辑器渲染（packages/editor/src/image-view.ts、code-block-view.ts）

- 未命名文档粘贴图片 = 直接内嵌 data URI 进 Buffer（用户裁定，勿改回「先保存」提示）；已保存文档写 `assets/`。保存后**不自动改写** data URI（R1 禁静默改写），状态栏一次性提示。
- `image-view.ts`：显示层把相对路径 src 解析为 data URI（`resolveImageSrc` prop），Buffer 序列化不变。
- code-block-view 本轮四修：① maybeEscape 落点必须在块外（文档边界不制造毒化状态）；② onDocSelectionChange DOM 选区不含块内时绝不抢焦点（曾致鼠标点击块外全被吞）；③ code_block schema 补 `createGapCursor` + gapCursor 插件（块下方续写靠 gap cursor）；④ Mod-End/Mod-Home 在 CM 内消化。改这个文件必须跑 ime + source-mode + code-block 系列 e2e。

### M4 人工验证暴露的教训（已修，防复发）

- 菜单命令「类型定义了但 renderer 忘了消费」= 静默死键。新增 MenuCommand 时必须同步消费 + e2e。
- dev StrictMode 双挂载会放大一切监听器泄漏；e2e 绿不代表无泄漏，需人工抽查弹窗次数。

## 3. 已知偏离 / 悬置（M5 输入）

| #   | 主题                                                                            | 状态                        |
| --- | ------------------------------------------------------------------------------- | --------------------------- |
| 1   | 全局快捷键注册表统一（Ctrl+/ 仍走 renderer capture）                            | 持续性任务，M5 顺手项       |
| 2   | theme-check 9 条硬编码豁免迁移                                                  | 待 `--md-fg-muted` 别名变量 |
| 3   | asset:save magic bytes 校验（M1 登记的 M4 项）                                  | **未做**，M5 必做           |
| 4   | packages/app 运行时导入 electron/shared 的 isAssetExt（无 Node 依赖）           | M5 复核依赖方向             |
| 5   | R5 性能：M3 复测冷启动/内存（≤300MB 口径）从未补测                              | M5 验收必须                 |
| 6   | renderer 1.99MB（M4 后 build:app），未做分包优化                                | 视 M5 性能结果决定          |
| 7   | Ctrl+End 已修；M4 e2e 曾暴露 HMR 中间态假错（`imageViewPlugin is not defined`） | 已消除，无遗留              |

## 4. M5 范围（TODO.md M5 节为权威）

- (P1) electron-builder 三平台安装包（NSIS / DMG / AppImage + deb）——注意 pnpm build 走 electron-builder，包体预算 ≤150MB（下载）/ ≤400MB（安装后）
- (P1) 代码签名与 macOS 公证（无证书则在发布说明标注未签名）
- (P1) 自动更新（electron-updater + 签名校验）
- (P1) 性能验收：包体 / 冷启动（第二次 <3s）/ 空文档内存 ≤300MB（**全部 md-editor 进程私有工作集之和**，development.md §7 两种口径以私有工作集为准）
- (P1) `user-guide.md` 按实际实现校对成稿 + 官网 landing page
- (P2) opt-in 崩溃上报
- 建议顺手项：#3 magic bytes、#1 快捷键注册表、#2 主题别名、R5 全表补测（含 1MB 打开 <500ms、10k 索引 <3s、万行滚动）
- 流程照旧：superpowers 计划先行（签名/更新器涉及外部证书与发布基础设施，先与用户确认证书可用性再排期）+ subagent-driven + TDD

## 5. 快速上手命令

```powershell
git log --oneline -5          # main，M4 全部合并（1995cb5）
git status                    # 应干净
pnpm test                     # 327 passed (38 files)
pnpm e2e                      # 49 passed（先 build:app）
pnpm theme:check              # 通过
pnpm dev                      # 本地开发窗口（人工测试用）
```
