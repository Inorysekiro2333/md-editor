# project-overview.md — 项目整体说明

## 一句话介绍

md-editor 是一个开源、跨平台的所见即所得 Markdown 编辑器：像 Typora 一样单栏实时渲染，
像普通文本编辑器一样直接读写本地 .md 文件。

## 为什么做这个项目

- Typora 是优秀但闭源收费的产品，社区缺少体验接近的**开源**替代（MarkText 已疏于维护）。
- 我们希望验证：以成熟的开源内核（Electron + Milkdown/ProseMirror），能否复刻 Typora 级别的写作手感。
- 净室开发：只研究 Typora 的**行为与交互**作为需求来源，不接触其代码与资源，不侵权。
- **壳选型（2026-10-15 评审）**：采用 Electron，而非 Tauri。三条理由：① 开发机零安装即可本地跑通（Tauri 需要 Rust + MSVC）；② Electron 自带 `webContents.printToPDF()`，静默导出 PDF 不需要额外引入 headless Chromium；③ Typora 本身即 Electron 应用，行为对齐成本更低。代价是包体与内存明显高于 Tauri——已用明确的预算口径接受（安装包 ≤150MB、冷启动 <3s、常驻内存 ≤300MB，见 `architecture.md` 5 节），不再追求"安装包 < 30MB"。

## 核心功能（v1 承诺）

| 功能 | 说明 |
|---|---|
| 所见即所得 | 输入 `# `、`- `、``` 等立即渲染，无预览分栏 |
| 源码模式 | CodeMirror 6 视图，与渲染模式一键切换、内容无丢失、**光标按 mdast 路径精确恢复** |
| GFM 全集 | 表格、任务列表、删除线；行内 HTML（消毒后）。脚注为 P2 尽力项 |
| 代码高亮 | 代码块语言选择 + 复制按钮；高亮方案在 M2 定型 |
| 主题系统 | CSS 变量驱动，内置 3 主题，第三方主题只需写 CSS |
| 工作台 | 多标签、文件树、大纲、查找替换、会话恢复、外部修改检测 |
| 导出 | PDF（Electron `printToPDF` 静默导出）、HTML（自包含） |
| 跨平台 | Windows / macOS / Linux，electron-builder 打包 |

## v1.1 承诺（架构评审后移入）

| 功能 | 说明 |
|---|---|
| 数学公式 | KaTeX，行内与块级，双击进入源码编辑 |
| 图表 | Mermaid，视口外懒加载，失败降级显示源码 |
| 导出长图 | `capturePage` 整篇渲染为 PNG |
| 导出 docx/odt | 依赖本机 pandoc，未安装时给出指引 |

> 移出理由：公式与图表都需要自定义 NodeView + 编辑态/渲染态切换 + 视口懒加载，是 v1 中最贵、最容易在中文 IME 上翻车的部分；先保证主干写作体验扎实，再补这两块。

## 明确不做（Non-goals）

- 云同步、协作编辑、账号体系
- 移动端
- 成为 Obsidian 式的知识库（双链仅在 v2 预研）
- 兼容 Typora 主题文件（提供我们自己的主题规范）
- 追求极致包体/内存（已用预算口径显式接受 Electron 的代价）

## 与竞品的关系

| 竞品 | 关系 |
|---|---|
| Typora | 体验标杆；交互为借鉴对象；同为 Electron 栈 |
| MarkText | MIT 开源；架构与失败教训的参考 |
| Obsidian | 定位不同（知识库 vs 写作工具） |
| VS Code Markdown 插件 | 通用编辑器，非专职写作体验 |

## 目标用户

1. 用 Typora 但希望开源/可定制的写作者
2. 需要本地纯文本、无锁定的笔记用户（配合 Git/iCloud 等同步盘）
3. 想要"所见即所得"而不是"分栏预览"的 Markdown 新手

## 路线图

见 `TODO.md`（M0–M5，约 11–14 周到 v1.0；公式与图表在 v1.1）。

## 许可与合规

- 代码：MIT
- 第三方素材：图标 Lucide（ISC）、字体 OFL/CC0
- 禁止任何 Typora 代码、主题、图标、文案的复制与衍生
- 商业字体/组件引入前必须核查许可并登记到 THIRD_PARTY_NOTICES.md
- Electron 及其运行时依赖的许可证需在打包流程中一并产出（M5）

## 相关文档

- `AGENTS.md` — AI 协作须知（必读）
- `DESIGN.md` — 视觉规范
- `architecture.md` — 架构与数据流
- `user-guide.md` — 使用者手册
- `development.md` — 开发方式与回归清单
- `component-api.md` — 组件与模块 API
- `TODO.md` — 任务与进度