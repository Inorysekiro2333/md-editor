# md-editor

开源、跨平台、所见即所得（WYSIWYG）的 Markdown 编辑器，体验对标 Typora：单栏实时渲染、无分栏预览、主题系统、源码模式一键切换。

![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## 特性

- **所见即所得**：基于 Milkdown（ProseMirror + remark）的单栏实时渲染编辑，Markdown 语法即时转换（标题、列表、表格、粗斜体/删除线/粗斜体、代码块、脚注）
- **源码模式**：CodeMirror 6 驱动的源码视图，一键切换（Ctrl+E），光标位置经 mdast 路径精确恢复
- **往返保真**：文件是唯一事实源——零编辑保存不写盘，编辑后的序列化差异逐条登记测试
- **工作台**：侧栏文件树（可折叠）、多标签页、查找替换、外部修改检测
- **格式工具栏**：加粗/斜体/删除线/行内代码/标题/列表/引用/插入表格，悬停显示快捷键
- **表格增强**：行列规格选择插入、增删行列、列宽拖拽、对齐保留
- **主题系统**：github-light / github-dark / paper-serif，CSS 变量驱动
- **导出**：静默 PDF（printToPDF）与自包含 HTML（图片内联、离线可用）
- **设置中心**：主题、导出选项持久化于 settings.json

## 下载

前往 [Releases](https://github.com/Inorysekiro2333/md-editor/releases) 下载对应平台安装包：

| 平台    | 格式                  |
| ------- | --------------------- |
| Windows | NSIS 安装包（`.exe`） |
| macOS   | DMG                   |
| Linux   | AppImage / deb        |

> 当前版本为未签名构建（macOS 首次打开需右键 → 打开；Windows SmartScreen 选择「仍要运行」）。

## 性能预算（发布验收口径）

| 指标                   | 预算   |
| ---------------------- | ------ |
| 安装包（下载体积）     | ≤150MB |
| 安装后磁盘占用         | ≤400MB |
| 冷启动（第二次及以后） | <3s    |
| 空文档常驻内存         | ≤300MB |

## 免责声明

本项目是一个纯 vibe coding 练习项目：由 AI（Codex）与人协作、以快速迭代方式编写，作者不对代码的正确性、稳定性、安全性作任何保证。使用本项目产生的一切风险与后果由使用者自行承担；请勿在未审查代码的情况下将其用于处理敏感或重要数据。

```bash
pnpm install        # 安装依赖（Node ≥ 20.19，pnpm 11）
pnpm dev            # 开发模式（Electron 主进程 + Vite HMR）
pnpm test           # 单元测试（Vitest）
pnpm e2e            # 端到端测试（Playwright + Electron）
pnpm lint           # ESLint + Prettier
pnpm typecheck      # TypeScript 全量检查
pnpm build          # 打包当前平台安装包（electron-builder）
pnpm theme:check    # 主题规范校验
```

技术栈：Electron 44 + React 18 + TypeScript + Milkdown 7（ProseMirror/remark）+ CodeMirror 6。
架构与设计决策见 [architecture.md](architecture.md)，开发规范见 [development.md](development.md)。

## 路线图

- **v1.1**：数学公式（KaTeX）、Mermaid 图表、导出长图 / docx
- **v2**：插件 API、Wiki 双链、Web 版

## License

[MIT](LICENSE)
