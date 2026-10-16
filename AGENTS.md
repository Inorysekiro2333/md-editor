# AGENTS.md — AI 协作须知（必读）

> 任何 AI 助手（Codex / Claude / Copilot 等）进入本仓库工作时，必须先读完本文。需求已由 grill-me 确认，无需重新 Brainstorming。
>
> **2026-10-15 架构评审结论**：桌面壳由 Tauri 改为 **Electron**，`packages/md-bridge` 已删除。凡本文与仓库内旧描述（含 `docs/superpowers/plans/` 下的历史计划）冲突，一律以本文为准。

## 项目是什么

**md-editor** 是一个开源、跨平台、所见即所得（WYSIWYG）的 Markdown 编辑器，
体验对标 Typora（单栏实时渲染、无分栏预览、主题系统、源码模式一键切换）。

- 技术栈：**Electron 44 + React 18 + TypeScript + ProseMirror（经 Milkdown 7 封装）+ CodeMirror 6（源码模式）+ remark/unified（大纲与索引）**
- 定位：Typora 的开源替代品。**净室开发**：只借鉴行为与交互，绝不反编译/抄袭 Typora 代码、主题与美术资源。
- 详细背景见 `project-overview.md`，架构见 `architecture.md`。
- 壳选型理由（详见 `architecture.md` ADR-3）：① 开发机零安装即可本地跑通；② Electron 自带 `webContents.printToPDF()`，静默导出 PDF 不需要额外引入 headless Chromium；③ Typora 同为 Electron 应用，行为差异可控。

## 三条铁律（违反即视为缺陷）

1. **往返保真（Round-trip fidelity）是最高优先级**
   - **文件级**：零编辑保存**不写盘**——Buffer 未被编辑过就直接跳过写入，磁盘内容天然不变。
   - **序列化层**：编辑后的序列化结果必须可预期；任何规范化差异（列表缩进、强调符号、空行、表格对齐等）都必须**逐条登记为测试用例**，禁止静默改变用户格式（用例位置见 `development.md` 6 节 R1）。

2. **Markdown Buffer 是唯一事实源（single source of truth）**
   ProseMirror Doc 只是 Buffer 的投影。任何功能不得让 PM Doc 独立于 Buffer 演化；
   源码模式 / 渲染模式切换必须无丢失，**光标位置通过 mdast 节点路径 + 节点内偏移精确恢复**（完整定义见 `architecture.md` 3.4）。
   唯一例外：渲染模式下的键入事务允许 PM Doc 短暂领先 Buffer，但必须在 300ms 防抖窗口内收敛回 Buffer。

3. **不要引入新的 Markdown 解析器/编辑器内核**
   渲染编辑内核统一 **Milkdown（内部即 ProseMirror + remark）**；源码模式统一 **CodeMirror 6**；大纲/字数统计统一走 remark/unified。
   引入第二套内核等于重写整个产品。

## 必须专项测试的高危区

- **中文输入法（IME）**：在标题、表格单元格、代码块内连打拼音、候选窗、撤销，都可能出问题。改动编辑器内核后必须手测 IME（见 `development.md` 6 节 R2）。公式块 IME 属 v1.1（KaTeX 已移出 v1）。
- **大文档性能**：> 2000 行文档不允许出现明显卡顿；渲染必须惰性（视口外不渲染 Mermaid/KaTeX，v1.1 起生效）。
- **文件监听循环**：自身写入触发的 watch 事件必须被抑制（写入凭证 + 500ms 兜底），否则会弹「文件被外部修改」误报。
- **进程边界**：渲染进程**不得**直接访问 Node/fs；所有文件操作必须经 `electron/preload` 的窄接口走 IPC（见 `development.md` 6 节 R7）。

## 仓库地图

```
electron/main/      Electron 主进程：窗口、菜单、文件 IO、watch
electron/preload/   contextBridge 契约（renderer 唯一对外通道）
packages/app/       React 工作台外壳（侧栏、标签页、查找替换、设置）
packages/editor/    Milkdown 内核封装 + CodeMirror 源码模式 + cursor-map
packages/export/    导出管线（PDF 走 printToPDF、HTML 自包含；长图/docx 属 v1.1）
packages/theming/   内置主题（CSS 变量）
e2e/                Playwright 用例（含 Electron 启动用例）
```

依赖方向只允许向下：`app → editor / export / theming`；`editor`、`export`、`theming` 之间不互相依赖，且都不得依赖 `app`。

## 常用命令（权威定义见 development.md）

```bash
pnpm install          # 安装依赖
pnpm dev              # 开发模式（Electron 主进程 + Vite HMR）
pnpm test             # 单元测试（Vitest）
pnpm lint             # ESLint + Prettier（覆盖 main/preload/renderer）
pnpm build            # 打包当前平台安装包（electron-builder；三平台在各自 CI 打包）
pnpm e2e              # Playwright（Electron + 浏览器两种模式）
pnpm theme:check      # 主题规范校验（M4 后可用）
```

## 与 AI 协作的约定

- 提交信息使用英文祈使句 + scope，如 `fix(editor): keep cursor when toggling source mode`。
- 修改 `packages/editor/src/cursor-map.ts` 必须附 `development.md` 6 节 **R3**（模式切换）的回归结果。
- 新增节点类型：在 `packages/editor` 注册 Milkdown preset/NodeView + 一份 round-trip 差异登记用例 + 必要时在 `DESIGN.md` 登记样式变量。
- 不确定设计取舍时，读 `TODO.md` 的优先级，P0 > P1 > P2；仍不确定就停下来问。
- 禁止把 Electron 的 `nodeIntegration` 打开，禁止在 renderer 里直接 `require('fs')`（安全基线见 `architecture.md` 2.3）。

## 跨文档事实速查（改任何文档前对照）

- 命令权威定义：`development.md`（dev / test / test:coverage / lint / build / e2e / theme:check）
- 主题 id：github-light / github-dark / paper-serif
- 里程碑：M0 骨架 · M1 编辑内核 · M2 源码模式与块级 · M3 工作台 · M4 主题与导出 · M5 发布
- 版本口径：公式（KaTeX）、图表（Mermaid）、长图、docx/odt = **v1.1**；Wiki 双链 = **v2**
- 编辑模式取值：wysiwyg | source
- 性能口径（权威值见 `architecture.md` 5 节）：安装包（下载体积）≤150MB · 安装后 ≤400MB · 冷启动（第二次及以后）<3s · 空文档常驻内存 ≤300MB

## CI / E2E 教训（2026-10-16 复盘，必守；来源见 docs/superpowers/plans/2026-10-16-m2-source-mode.md Ledger）

1. **e2e 禁止用 DOM 选区断言编辑器光标**（getSelection / range.toString）：Chromium 在块边界用元素锚点+childOffset，Linux CI 缺 CJK 字体使点击命中落点漂移，全部产生伪值。光标断言一律用编辑器状态真值：只读调试钩子 `__mdEditorDebug.pmSelection / cmSelection`（EditorHost / SourceEditor 提供，无写能力）。
2. **Playwright evaluate 返回值经 JSON 序列化，函数无法传回 Node 侧**；页面内钩子必须在 evaluate 回调里调用、只返回数据（返回函数会静默变 undefined）。
3. 与 Milkdown/CM 异步创建交互的 e2e 步骤，必须先等 `[data-editor-ready="true"]`（App onReady 置位）再操作；点击后用状态钩子校验到位，未到位重试（参考 e2e/source-mode.spec.ts）。
4. 跨模式光标等值断言只在「两模式块文本相同」的块（普通段落）内合法；标题行存在 `# ` 前缀差，代码行有围栏差。
5. 改 cursor-map 边界时，**leaf 末尾**（段落/标题/列表项/表格单元格/代码块 value 末尾）必须有双向精确用例（development.md 6 节 R3）；PM pos 语义 = nodeStart + nodeSize − 1 是内容末尾，写测试别把闭包 token 算进去。
6. CI 只在 push main 与 PR 触发；调试分支验证必须开 PR。e2e 失败先分层定位「产品 bug / 测试竞态 / 断言伪值」，禁止靠删断言转绿；临时诊断代码（debug 钩子、dump）用后要么登记为基础设施、要么删除。

## AI 执行效率规范（2026-10-16 复盘新增）

本节约束所有 AI 助手在本仓库执行多任务计划（subagent / inline 均适用），目的是消除无效开销：

1. **上下文最小化**：给子代理的任务指令只包含「任务定位 + 与计划的差异点 + 硬门槛 + 输出格式」；项目铁律让它自己读 AGENTS.md，不要整段复述。评审报告只转发 findings（文件:行号 + 一句话），验证过程不入交接消息。
2. **硬门槛前置**：任何提交前必须先过 lint + typecheck + 相关测试，不许把格式/类型问题留到评审轮。
3. **等待即长等**：wait 类调用首次就用足够长的 timeout，超时返回空结果时先查状态再重等，不连续盲等。
4. **文本编辑用脚本**：对含反引号/正则特殊字符的文档做批量替换时，写临时脚本文件执行（PowerShell 双引号会吃 backtick）；改前先看文件真实内容，替换后校验生效（不许静默失败）。
5. **资源即用即关**：子代理完成后立即关闭，不攒到并发上限。
6. **验证抽查**：上一环节已贴真实输出的命令，下一环节只抽查关键项，不全量复读。
7. **输出压缩**：评审结论 = 结论 + findings 列表 + 关键数字；简报 ≤ 5 行；禁止无信息量的复述与反思。
