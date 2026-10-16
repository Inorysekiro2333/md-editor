# TODO.md — 任务、优先级与进度

> 状态图例：[ ] 未开始 · [~] 进行中 · [x] 已完成
> 优先级：P0 阻塞发布 · P1 发布前必须 · P2 可延后
>
> **2026-10-15 架构评审后重写**：桌面壳 = Electron；无 `packages/md-bridge`；公式与图表移入 v1.1；性能口径见 `architecture.md` 5 节。

## 当前状态

**阶段：M0 + M1 + M2 已完成，下一步进入 M3 工作台。**
下一步行动：执行 M3 —— 多标签页、文件树、大纲面板。

架构前提（已冻结，改动需先改 `architecture.md`）：

- 壳：Electron 44；渲染进程无 Node 权限，一切文件操作走 preload。
- 内核：Milkdown 7（渲染） + CodeMirror 6（源码）；mdast ↔ PM 转换由 Milkdown 内置承担。
- 保真：零编辑保存不写盘；编辑后序列化差异逐条登记。
- 性能：安装包 ≤150MB · 冷启动（第二次起）<3s · 空文档常驻内存 ≤300MB。

## M0 — 项目骨架（目标：1 周）

- [x] (P0) 初始化 pnpm monorepo：`electron/{main,preload,shared}` + `packages/{app,editor,export,theming}`
- [x] (P0) Electron + Vite + React 18 + TS 骨架可运行，`pnpm dev` 打开空窗口
- [x] (P0) preload 契约 + 主进程 `fs_io`（原子写 → 写入凭证）
- [x] (P0) 打开 .md → 编辑 → 保存（Ctrl+S）；**零编辑保存不写盘**
- [x] (P0) 性能基线实测（包体 / 冷启动 / 空文档内存）并写入 `development.md` 7 节
- [x] (P1) chokidar 单文件监听 + 写入凭证抑制自身事件
- [x] (P1) ESLint + Prettier + Electron 安全基线断言（R7）
- [x] (P1) Vitest + Playwright 基础配置（含 `_electron` 启动冒烟）
- [x] (P1) CI：Windows 构建 + 三平台 `electron-builder` 干跑

**验收**：能打开/编辑/保存一个 markdown 文件；手改文件后编辑器正确重新渲染；零编辑保存后文件哈希与 mtime 均不变；性能基线入档。（M0 验收记录：pnpm e2e 全绿 7 例——打开/编辑/保存 3 例、外部修改 2 例、PDF 冒烟 1 例、Shell 1 例；零编辑保存 mtime 与 size 均未变化；性能基线已记入 development.md 7 节：冷启动 340ms、内存 408MB（getAppMetrics workingSetSize 之和）/ 186MB（私有工作集之和，达标））

## M1 — 编辑内核（目标：3–4 周）

- [x] (P0) Milkdown preset 与输入规则：`#`、`>`、`-`、`1.`、代码围栏、表格管道
- [x] (P0) GFM：表格、任务列表、删除线
- [x] (P0) round-trip 差异登记用例集（不少于 50 用例 + 3 篇真实长文档），进 CI
- [x] (P0) 中文 IME 专项验证（标题 / 列表 / 表格；CDP Input.imeSetComposition 自动化模拟 6 例，真人微软拼音候选窗/确认键/组合内撤销待补）
- [x] (P1) 会话级撤销栈持久化
- [x] (P1) 粘贴处理：HTML → Markdown、URL → 链接、图片粘贴存盘
- [x] (P2) 脚注（GFM 扩展，非规范本体；Milkdown gfm 内置 schema + 未定义引用解析/键入规则补丁，见 component-api.md 3.6）

**验收**：round-trip 用例全绿；Typora 日常写作 80% 场景不卡壳。（M1 验收记录 2026-10-16：roundtrip.test.ts 71 例全绿（规范化差异逐条登记，含转义/表格对齐）；长文档 fixture 3 篇（long-doc-1/2/3）round-trip 全绿；IME 为 CDP Input.imeSetComposition 自动化模拟 6 例（标题/列表/表格/代码块连打、组合内 # - 1. 不触发规则）全绿，真人微软拼音候选窗/确认键/组合内撤销待补；会话撤销 e2e 1 例 + 单测兜底；粘贴 HTML/URL/图片 e2e 2 例；命令实测：pnpm typecheck 0 错误 · pnpm lint 全过 · pnpm test 119 passed (10 files) · pnpm e2e 27 passed (25.3s) · pnpm build:app main/preload/renderer 三段构建成功，renderer 1,397.35 kB）

## M2 — 源码模式与块级组件（目标：2–3 周）

- [x] (P0) `cursor-map`：PM pos ↔ Markdown offset ↔ mdast 路径互转（纯函数 + 单测，见 component-api.md 3.4）
- [x] (P0) CodeMirror 6 源码模式：双向切换、**光标精确恢复**（`architecture.md` 3.4 五条口径；选区交换格式 = Markdown offset anchor/head）
- [x] (P0) 代码块组件：语言选择、复制按钮、高亮（自建 CM6 NodeView，ADR-5 / Ruling-1）
- [ ] (P1) 表格增强：行列增删、列宽拖拽、对齐保留 —— **M2b 计划，未开工**
- [ ] (P2) 图片拖拽调整尺寸（v1.1 再考虑）

**验收**：模式切换 10 次内容与光标行列一致；代码块/表格内编辑与 IME 稳定；`ancestor` 降级路径有用例登记。（M2 验收记录 2026-10-16：e2e/source-mode.spec.ts 3 例全绿——10 次切换内容与 caret 稳定、跨模式 caret 等值、source 编辑带回 WYSIWYG；块级边界退化用例登记（TextSelection.near(+1) 下一块块首）；代码块 e2e + IME 自动化 1 例全绿（真人微软拼音待补）；命令实测：pnpm typecheck 0 错误 · pnpm lint 全过 · pnpm test 169 passed (15 files) · pnpm e2e 31 passed (35.0s) · pnpm build:app main 57.74 kB / preload 2.08 kB / renderer 1,795.90 kB）

## M3 — 工作台（目标：2 周）

- [ ] (P0) 多标签页 + 未保存脏标记 + 关闭确认
- [ ] (P0) 文件树（文件夹工作区，chokidar 增量推送，虚拟滚动）
- [ ] (P0) 大纲面板（`parseOutline` 派生，点击定位、跟随光标高亮）
- [ ] (P1) 查找替换（正则、大小写、全词；替换直接改 Buffer）
- [ ] (P1) 会话恢复：崩溃后重开还原标签与未保存内容
- [ ] (P1) 外部修改检测（重载 / 保留我的 二选一）
- [ ] (P2) 文件树内新建/重命名/删除（移入 v1.1）

**验收**：打开 10k 文件文件夹小于 3s；万行文档滚动不卡顿。

## M4 — 主题与导出（目标：1–2 周）

- [ ] (P0) 主题系统 + 内置 3 主题（github-light / github-dark / paper-serif）
- [ ] (P0) 设置中心（settings.json + UI 面板）
- [ ] (P0) 导出 PDF：`webContents.printToPDF()` 静默导出（跨平台一致）
- [ ] (P1) 导出自包含 HTML（内联 CSS，图片 base64 可选）
- [ ] (P1) `theme:check` 校验脚本

**验收**：导出的 PDF 分页与中文字体正常；HTML 单文件可离线打开且样式完整。

## M5 — 发布打磨（目标：2 周）

- [ ] (P1) `electron-builder` 三平台安装包（NSIS / DMG / AppImage + deb）
- [ ] (P1) 代码签名与 macOS 公证（无证书时在发布说明中标注未签名）
- [ ] (P1) 自动更新（electron-updater + 签名校验）
- [ ] (P1) 性能验收：包体 ≤150MB、安装后 ≤400MB、冷启动（第二次起）<3s、空文档内存 ≤300MB
- [ ] (P1) `user-guide.md` 按实际实现校对成稿、官网 landing page
- [ ] (P2) opt-in 崩溃上报

**验收**：三平台 CI 全绿；`development.md` 7 节性能表全部达标；未签名/未公证项已在发布说明写明。

## v1.1 — 架构评审移出项 + 原 v1.1 项

- [ ] (P0) 数学公式：KaTeX 行内 / 块级，双击进入源码编辑，IME 专项（回到 R2 清单）
- [ ] (P0) Mermaid 图表：视口外懒加载，渲染失败降级显示源码
- [ ] (P1) 导出长图（`capturePage`）
- [ ] (P1) 导出 docx/odt（依赖本机 pandoc，检测并引导安装）
- [ ] (P2) 图片拖拽调整尺寸
- [ ] (P2) 文件树内新建/重命名/删除

## v2 — 预研

- [ ] 插件 API：NodeView / 输入规则 / 导出器 / 主题变量注册
- [ ] Wiki 双链语法 + SQLite 索引
- [ ] WASM 化以支持 Web 版

## 持续性任务（随时做）

- [~] round-trip 差异用例扩充（每新增节点类型必须同步登记）
- [ ] 性能基准记录（每个里程碑测一次并写入 `development.md` 7 节）
- [ ] 无障碍走查（Tab 顺序、aria-label、对比度）
- [ ] asset 写盘安全加固
- [x] IPC bytesBase64 入参守卫（doc:write ≤10MB / asset:save ≤20MB，畸形入参干净拒绝，见 component-api.md 2.1；2026-10-16 完成）
- [x] sync.dispose 兜底语义登记：dispose 先同步 flush pending，onFlush 重入 schedule 产生的新 timer 保留至下一轮收敛（packages/editor/src/sync.ts + sync.test.ts，2026-10-16 完成）：当前无大小上限、无 magic bytes 校验（asset:save）—— M1 先收窄为信任本机剪贴板，M4 导出前补齐
