# architecture.md — 架构与数据流

> **2026-10-15 架构评审结论**：桌面壳由 Tauri 改为 **Electron**；`packages/md-bridge` 删除，mdast ↔ PM 转换由 Milkdown 内置承担；性能口径整体替换（见 5 节）。本文是架构的权威文档，与旧描述冲突时以本文为准。

## 1. 技术栈总览

| 层 | 选型 | 备注 |
|---|---|---|
| 应用壳 | **Electron 44** | 主进程握有 Node 能力；渲染进程是 Chromium，无 Node 权限 |
| 前端 | React 18 + TypeScript | Zustand 管理外围状态 |
| 编辑内核 | **Milkdown 7**（内部即 ProseMirror + remark） | 渲染模式唯一内核，schema 与序列化均采用其默认行为 |
| 源码模式 | **CodeMirror 6** | 与渲染模式共享 Buffer，只作视图 |
| Markdown | remark / unified | 仅用于大纲、字数、索引与光标路径解析 |
| 导出 | **Electron `webContents.printToPDF()`** / 自包含 HTML | 静默 PDF 不需要额外引入 headless Chromium |
| 文件监听 | **chokidar 5** | 主进程侧，配合写入凭证抑制自身事件 |
| 打包 | **electron-builder 26** | NSIS / DMG / AppImage + deb |
| 测试 | Vitest + Playwright（`_electron` 启动 + 浏览器模式） | round-trip 差异用例全绿是 CI 门禁 |

## 2. 分层架构

```
┌──────────────── 渲染进程（Chromium，无 Node 权限）────────────────┐
│ 工作台外壳：侧栏 / 标签页 / 状态栏 / 对话框 / 查找替换            │
│ 编辑器层：Milkdown（渲染） + CodeMirror 6（源码） + cursor-map    │
│ 文档数据层：MdDocument（Buffer 唯一事实源）/ 大纲 / 历史           │
│ 系统服务：主题 / 导出（拼 HTML） / 设置 / 快捷键路由               │
└───────────────▲──────────────────────────────────────────────────┘
                │ contextBridge 窄接口（白名单方法）+ ipcRenderer.invoke
┌───────────────┴──────────────────────────────────────────────────┐
│ 主进程（Node）：窗口与菜单 / 文件 IO（原子写）/ chokidar 监听      │
│               / 导出（printToPDF）/ 会话快照 / 自动更新 / 单实例锁  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.1 主进程职责（`electron/main/`）

- `fs_io`：读/写/重命名/删除；**原子写**（写 `.tmp` → `fsync` → `rename`，Windows 上 `rename` 覆盖语义由 Node `fs.rename` 提供，Linux 额外 `fsync` 父目录）。
- `watcher`：chokidar 监听当前文件（M0）与工作区（M3）；**凭写入凭证（size + mtime）抑制自身写入事件**，500ms 时间窗仅作兜底。
- `workspace_index`：大文件夹扫描（后台线程/异步任务），文件树增量推送到渲染进程。
- `window/menu/tray`：原生菜单、快捷键、单实例锁。
- `export`：`webContents.printToPDF()`（静默 PDF）、自包含 HTML 组装；长图与 docx 属 v1.1。
- `updater`：自动更新与签名校验（M5）。

### 2.2 渲染进程组成（`packages/*`）

| 包 | 职责 | 关键约束 |
|---|---|---|
| `packages/app` | React 外壳、状态编排、查找替换 UI | 不直接访问 Node/fs；只经 preload 接口 |
| `packages/editor` | Milkdown 封装、输入规则、NodeView、CodeMirror 源码视图、`cursor-map` | 不做 IO；不引入第二套解析/编辑内核 |
| `packages/export` | 导出管线的前端部分（生成自包含 HTML、调用主进程导出） | 不依赖 app 状态 |
| `packages/theming` | 主题加载与校验 | 只允许 CSS 变量 |

> **已删除**：`packages/md-bridge`。mdast ↔ ProseMirror 的转换改由 Milkdown 内置管线承担（ADR-2）。

### 2.3 安全基线（硬约束）

1. `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` —— 渲染进程不得有任何 Node 能力。
2. 渲染进程与主进程之间**只有** `electron/preload` 暴露的窄接口（白名单方法 + 参数校验），禁止透传 `ipcRenderer` 本体。
3. 生产构建启用 CSP，禁止 `unsafe-eval` 与远程脚本；禁用 `webview` 标签与 `@electron/remote`。
4. 打开外部链接一律走系统浏览器（`shell.openExternal`），并校验协议白名单（http/https）。
5. 渲染进程引入的任何依赖都要经打包器固化，禁止运行时 `require` 用户目录下的脚本。

## 3. 核心数据流

### 3.1 唯一事实源原则

```
Markdown Buffer（字符串）  ←—— 唯一事实源
        │ remark 解析（只读）
        ▼
     mdast  ←—— 大纲 / 字数 / 搜索索引 / 光标路径
        │ Milkdown 内置转换
        ▼
   PM Doc  ←—— 所见即所得视图的投影
```

- 所有持久化都发生在 Buffer 上；PM Doc 永远可以从 Buffer 重建。
- 源码模式 = Buffer 的 CodeMirror 视图；渲染模式 = Buffer 经 Milkdown 的 ProseMirror 视图。
- 键入事务是唯一允许 PM Doc 短暂领先 Buffer 的路径，且必须在 300ms 防抖窗口内收敛回 Buffer；除该路径外，一切修改从 Buffer 进入。
- **序列化控制权说明**：转换与序列化由 Milkdown（内部 remark-stringify）完成，我们不重复实现。因此"编辑后格式可能与原文风格不同"是已知现实，必须用差异登记用例把可接受的规范化逐条固定下来（见 `development.md` 6 节 R1）。

### 3.2 键入的生命周期（渲染模式）

```
键入 "# Hello"
→ ProseMirror 输入规则：DOM 变为 <h1>，PM Doc 产生 transaction
→ MdDocument 监听 transaction，标记 dirty
→ 防抖 300ms：PM Doc --serialize--> Buffer（Milkdown 的 getMarkdown）
→ Buffer 变化同步到渲染进程内的 mdast（大纲/字数增量更新）
→ 自动保存（默认开，1.5s 防抖）经 preload → 主进程写盘，并记录写入凭证
→ watcher 比对凭证抑制本次事件（500ms 时间窗仅兜底）
```

### 3.3 打开文件与保存

```
用户选择文件 → 主进程读入原始字节（保留 BOM/CRLF 元信息）
→ 经 preload 传 { base64, text, eol, hasBom } 给渲染进程
→ MdDocument 创建（Buffer + 原始字节缓存）→ Milkdown 渲染
```

- **零编辑保存 = 不写盘**：Buffer 未被编辑过时，`Ctrl+S` 直接跳过写入事务，磁盘内容天然字节级不变（这是文件级往返保真的实现方式）。
- 编辑后保存：以 `text` 的 UTF-8 字节原子写盘；此路径不承诺与原文风格逐字节一致，差异必须落在 3.1 所说的登记用例里。
- CRLF/BOM：打开时记录，保存时按记录的元信息还原包装（BOM 前缀 + 换行风格），保证"没编辑就不动、编辑后不额外改变换行风格"。

### 3.4 光标精确恢复（模式切换）

切换渲染 ↔ 源码时，光标位置不用行列号传递，而是保存 **mdast 节点路径 + 节点内偏移**，规则如下（这 5 条是验收定义）：

1. 保存形式为 `{ path: number[], offset: number }`，选区保存 `anchor` 与 `head` 两端；实现位于 `packages/editor/src/cursor-map.ts`（纯函数，不碰 DOM 与 IO）。
2. 恢复时按同一路径在目标文档中定位；**仅当切换前后内容未变时，承诺逐字符等价**。
3. 若路径在目标文档中已不存在（切换后结构被修改），退化为"最近祖先节点 + 块首"；**该退化行为必须登记为测试用例**，不得对外宣称永远精确。
4. 滚动位置按"当前块在视口中的相对比例"恢复，不做绝对像素对齐。
5. 验收方式：`cursor-map` 纯函数单测 + e2e 连续切换 10 次，断言内容一致且光标所在行列一致。

### 3.5 外部修改与冲突

```
watcher 收到变更 → 比对最近一次写入凭证（size + mtime）
→ 匹配（自身写入）→ 忽略；不匹配 → 读盘比较
  → Buffer 干净 → 自动重载
  → Buffer 脏 → 弹窗：重载（丢弃我的）/ 保留我的（另存提示）
```

## 4. 关键设计决策（ADR 摘要）

| # | 决策 | 理由 |
|---|---|---|
| ADR-1 | Buffer 为唯一事实源，PM Doc 是投影 | 保证源码/渲染切换无损、往返保真可测试（**不变**） |
| ADR-2 | ~~独立 `packages/md-bridge` 纯函数包~~ **已撤销（2026-10-15）** | Milkdown 内部已实现 remark ↔ ProseMirror，重复实现属于第二套转换逻辑且维护成本高；代价是序列化控制权下降，用差异登记用例兜底 |
| ADR-3 | 桌面壳用 **Electron**（取代 Tauri，2026-10-15） | ① 开发机零安装即可本地跑通（此前 Tauri 需要 Rust + MSVC）；② 自带 `printToPDF()`，静默 PDF 免去 headless Chromium；③ Typora 同为 Electron，行为对齐成本低。代价：包体与内存显著高于 Tauri，已通过 5 节预算显式接受 |
| ADR-4 | 导出 PDF 用 `webContents.printToPDF()`（取代 headless Chromium 兜底） | Electron 原生能力，静默、跨平台一致；长图走 `capturePage`（v1.1） |
| ADR-5 | 表格/代码块用 NodeView 而非纯 DOM 规则 | 复杂交互需要组件生命周期 |
| ADR-6 | 查找替换对外语义是改 Buffer，内部实现为单个 ReplaceStep transaction | Ctrl+Z 可整体撤销，避免逐项 dispatch 卡顿 |
| ADR-7 | 会话快照存 appdata，每 5s | 崩溃恢复；不给文件本身写临时垃圾 |

## 5. 性能预算（2026-10-15 生效，取代旧值）

| 指标 | 预算 | 测量口径 |
|---|---|---|
| 安装包（下载体积） | ≤150MB | electron-builder 产物文件大小 |
| 安装后磁盘占用 | ≤400MB | 安装目录实际占用 |
| 冷启动（第二次及以后） | **< 3s** | 从进程启动到编辑区可输入 |
| 首次冷启动 | < 8s | 含系统 Defender 扫描等一次性开销，单列宽松值 |
| 打开 1MB markdown | < 500ms | 文件读取到渲染完成 |
| 10k 文件文件夹索引 | < 3s（后台，不阻塞 UI） | 索引完成事件时间 |
| 渲染模式键入延迟 | < 16ms/帧 | 防抖序列化时间不计入 |
| 空文档常驻内存 | **≤300MB** | 单窗口、release 构建、**全部 md-editor 进程的私有工作集之和** |
| Mermaid / KaTeX | 视口外不渲染 | v1.1 起生效 |

测量结果按里程碑记录在 `development.md` 7 节；M0 必须记录一次基线（含实测内存），若基线超预算则由用户重新裁定数字，而不是等到 M5 才发现。

## 6. 扩展点（v1.1 / v2 预留）

- **v1.1**：KaTeX 行内/块级公式、Mermaid 图表（视口懒加载）、导出长图（`capturePage`）、导出 docx/odt（依赖本机 pandoc，检测并引导安装）。
- **v2**：插件 API（NodeView / 输入规则 / 导出器 / 主题变量注册）、Wiki 双链（`[[...]]` 解析 + SQLite 索引）、WASM 化以支持 Web 版。