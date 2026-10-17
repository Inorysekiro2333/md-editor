# component-api.md — 组件与模块 API

> 面向贡献者的 API 参考（目标形态）。API 变更必须同步更新本文件。
>
> **2026-10-15 架构评审**：删除 `packages/md-bridge`；IPC 由 Tauri command 改为 Electron preload 契约；新增 `cursor-map`（光标精确恢复）；导出 PDF 改走 `printToPDF`。

## 1. 文档数据层

### 1.1 MdDocument（`packages/app/src/document`）

一个打开的文档实例，承载「Buffer 唯一事实源」原则。

```ts
interface MdDocumentOptions {
  path: string | null // null = 未保存的新文档
  initialText: string
  initialBytesBase64: string // 打开时的原始字节，用于「零编辑不写盘」
  encoding?: 'utf-8'
  eol?: 'lf' | 'crlf' // 检测自原文件
  hasBom?: boolean
}

class MdDocument {
  readonly id: string
  get text(): string // 当前 Buffer
  get isDirty(): boolean
  get path(): string | null
  get eol(): 'lf' | 'crlf'
  get hasBom(): boolean

  // 订阅：'change' | 'dirty' | 'saved' | 'external-modified'
  on<E extends DocEvent>(event: E, cb: (payload: DocEventPayload[E]) => void): Unsubscribe

  applyEditorMarkdown(markdown: string): void // 渲染模式防抖收敛：PM Doc -> Markdown -> Buffer
  replaceText(range: TextRange, replacement: string): void
  /** 未编辑返回 null —— 调用方必须跳过写盘（零编辑保存 = 不写盘） */
  bytesForSave(): string | null
  markSaved(credential?: WriteCredential | null): void // 保存失败/重置时可传 null
  setExternalText(text: string, originalBytesBase64: string): void // 外部修改且 Buffer 干净时自动重载
}
```

不变式：MdDocument 永远能由 `text` 重建视图（Milkdown Doc / CodeMirror Doc）与只读投影（mdast）；任何修改最终必须落到 `text`。

### 1.2 文件 IO（`electron/main/fs_io.ts`）

```ts
export interface FileContent {
  base64: string // 原始字节；零编辑不写盘时不需要它，但外部重载与哈希比对要用
  text: string // 去 BOM 后的 UTF-8 文本
  eol: 'lf' | 'crlf'
  hasBom: boolean
}

export interface WriteCredential {
  path: string
  size: number
  mtimeMs: number
  writtenAtMs: number // 供 watcher 的 500ms 兜底窗口使用
}

export async function readFile(path: string): Promise<FileContent>
export async function writeAtomic(path: string, bytes: Buffer): Promise<WriteCredential>
```

`writeAtomic`：写 `.tmp` → `fsync` → `rename`（Linux 额外 `fsync` 父目录）；返回值写入凭证供 watcher 比对以抑制自身事件。

## 2. Electron IPC 契约

### 2.1 preload 暴露面（渲染进程唯一通道，`electron/preload/index.ts`）

doc:write / asset:save 的二进制载荷经主进程 `electron/shared/base64.ts` 守卫：
`isValidBase64Payload(value, maxBytes)` 校验 string、base64 字符集/填充（拒绝
全填充空串如 `'===='`）、解码字节数上限（doc:write ≤ 10MB，asset:save ≤
20MB）；非法载荷在主进程入口干净拒绝，不触碰磁盘。

```ts
export interface MdEditorBridge {
  showOpenDialog(): Promise<string | null>
  readFile(path: string): Promise<FileContent>
  writeFile(path: string, bytesBase64: string): Promise<WriteCredential>
  getAppInfo(): Promise<AppInfo> // { version, electron }
  watchFile(path: string): Promise<void> // M0 单文件；M3 扩 workspace:watch
  saveAsset(docPath: string, bytesBase64: string, ext: string): Promise<string> // M1 粘贴图片存盘（asset:save）
  onExternalModified(handler: (path: string) => void): () => void
  onOpenFile(handler: (path: string) => void): () => void // app:open-file（--open CLI 触发）
  exportPdf(html: string, target: string): Promise<void> // 目标形态（M4）
  exportHtml(content: string, target: string): Promise<void> // 目标形态（M4）
}

declare global {
  interface Window {
    mdEditor: MdEditorBridge
  }
}
```

规则：

- 渲染进程**禁止**直接使用 `ipcRenderer` / `require('fs')`；preload 只暴露白名单方法，并对参数做类型与路径校验。
- 新增能力必须同时改三处：preload 白名单、主进程 handler、本文档 7 节 IPC 表。

### 2.2 通道与事件命名

- invoke 通道：`域:动作`。M0 已实现：`app:info` / `doc:read` / `doc:write` / `watch:file`；`export:pdf` / `export:html` 为目标形态（M4）。
- 主进程 → 渲染进程事件。M0 已实现：`app:open-file`（`path: string`，`--open` CLI 触发）、`fs:external-modified`；`menu:command` 为目标形态（M3）。

## 3. `packages/editor`

### 3.1 EditorHost — React 挂载组件

```tsx
<EditorHost
  doc={mdDocument}
  mode="wysiwyg" | "source"
  theme={themeName}
  onCursorChange={(pos: MdPath) => void}
  onScrollSync={(ratio: number) => void}
/>
```

组件内部持有 Milkdown 的 Editor 与 CodeMirror 的 EditorView，随 mode 切换；切换时通过 `cursor-map` 做光标映射，外部无需关心。

```ts
export interface EditorHandle {
  getMarkdown(): string
  flushNow(): void
  getSelectionOffsets(): { anchor: number; head: number } | null // Markdown offset（未就绪时 null）
  setSelectionOffsets(anchor: number, head: number): void
  focus(): void
  getScrollRatio(): number
}
```

模式切换语义（App 层编排）：切换前 `flushNow()`（300ms 防抖收敛回 Buffer）→
`getSelectionOffsets()` capture（**交换格式 = Markdown offset 的
anchor/head**，内部经 `pmPosToMarkdownOffset` 投影）→ 挂载目标模式组件 →
`setSelectionOffsets()` restore。WYSIWYG 侧 `applySelectionOffsets` 把 offset
映射回 PM pos；offset 落在块级边界空位时 `TextSelection.near(+1)` 退化到
**下一块块首**（accuracy=ancestor），保证切换永不因光标恢复而崩溃。滚动按
比例恢复（scrollTop/scrollHeight；逐块视口比例记录为已知简化）。

### 3.2 防抖收敛

```ts
export function createMarkdownSync(options: {
  delayMs?: number // 默认 300ms，与 architecture.md 3.2 一致
  serialize(): string
  onFlush(markdown: string): void
}): {
  schedule(): void
  flushNow(): void
  dispose(): void
  readonly pending: boolean
}
```

dispose 语义（M2 变更）：`dispose()` 先同步 flush pending（unmount 不再丢
Buffer 收敛）；若 `onFlush` 重入 `schedule()` 产生了新 timer，则保留至下一轮
收敛，不再被 dispose 尾部清理吞掉。

### 3.3 输入规则补齐

```ts
export const editorInputRules: MilkdownPlugin
```

由 `$prose` 封装的插件（当前含一个 Enter 键位规则）：在段落末尾键入
`| a | b |` 后按 Enter，将该段替换为 GFM 表格（首行即表头）。复用 gfm
preset 注册的 table 节点，不引入第二套解析器。已在 `EditorHost.tsx`
插件链中追加 `.use(editorInputRules)`，无需业务方手动挂载。

### 3.4 cursor-map — 光标精确恢复（`packages/editor/src/cursor-map.ts`）

纯函数模块，不碰 DOM 与 IO（remark 层 + ProseMirror bridge 层）。语义定义见
`architecture.md` 3.4（5 条验收口径）；remark 解析管线与 Milkdown transformer
一致（remark-parse + remark-gfm），保证表格/删除线等 GFM 结构对应。

```ts
// remark 层（M2 Task 1）
export interface MdCursor {
  path: number[] // mdast 节点在父节点 children 中的下标路径
  offset: number // 相对最深节点 position.start.offset 的偏移
}

export function mdOffsetToCursor(markdown: string, offset: number): MdCursor
export function cursorToMdOffset(markdown: string, cursor: MdCursor): number

// PM bridge 层（M2 Task 2，lockstep 平行游走）
export type CursorAccuracy = 'exact' | 'ancestor'
export interface PositionResult {
  pos: number
  accuracy: CursorAccuracy
}

export function pmPosToMarkdownOffset(markdown: string, doc: PMNode, pos: number): number
export function markdownOffsetToPmPos(markdown: string, doc: PMNode, offset: number): PositionResult
export function pmPosToMdCursor(markdown: string, doc: PMNode, pos: number): MdCursor
export function mdCursorToPmPos(markdown: string, doc: PMNode, cursor: MdCursor): PositionResult
```

语义要点：

- 所有 offset 均为 Markdown 字符串的 UTF-16 下标；`cursor.offset` 相对最深节点起点。
- `exact` = PM 文本区与 mdast 叶子内容区逐字符一一对应（文本 / inlineCode / 代码块 / 加粗斜体删除线链接包裹段 / 原子节点边界）。
- `ancestor` = 结构不对应或落在边界空位时，映射到最近文本边界或块首；平局取后方锚点。`mdCursorToPmPos` 的 path 失效逐级回退最近可解析祖先块首；PM 块级边界（offset 在块间空位）恢复时由调用方用 `TextSelection.near(+1)` 退化到**下一块块首**（见 3.1 `applySelectionOffsets`）。
- 契约：只有 `exact` 才代表逐字符等价；`ancestor` 必须在切换用例里登记，不得对外宣称永远精确。
- 登记用例：`cursor-map.test.ts`（含全文 PM pos / Markdown offset 双向扫描）。

### 3.5 只读投影（remark）

```ts
export function parseOutline(markdown: string): OutlineNode[] // 大纲：标题层级 + 位置
export function countWords(markdown: string, opts?: { cjk?: boolean }): number
```

两者都是纯函数，供状态栏与大纲面板使用；不参与编辑内核。（M3 计划 API，当前尚未实现，实现时以本节签名为准）

### 3.6 脚注（GFM 扩展）

脚注由 Milkdown gfm preset 内置的 `footnote_reference`（行内原子节点，
DOM 形态 `sup[data-type="footnote_reference"]`）与 `footnote_definition`
（块级节点，DOM 形态 `dl[data-type="footnote_definition"]`）承担，
序列化/解析走 remark（mdast `footnoteReference`/`footnoteDefinition`），
不引入第二套解析器。`packages/editor` 补齐两块 gfm preset 未覆盖的能力：

```ts
export const footnoteUndefinedRefPlugin: MilkdownPlugin // remark 解析补丁
export const footnoteInputRules: MilkdownPlugin // ProseMirror 键入规则
```

- `footnoteUndefinedRefPlugin`：remark-gfm 只解析「有定义」的 `[^label]`；
  未定义引用留在 text 节点并在序列化时被转义。该插件在解析后把 text 中残留的
  `[^label]` 补转换为 footnoteReference，保证未定义引用可往返（多引用、
  嵌套强调/链接均由 gfm schema 原生支持）。
- `footnoteInputRules`：WYSIWYG 键入/粘贴时，段落内完整 `[^label]` 自动转为
  引用节点；文档顶层段落形如 `[^label]: 内容` 自动转为定义块——否则序列化时
  会被当作普通文本转义，破坏 Buffer 往返。

两者已在 `EditorHost.tsx` 插件链（gfm 之后）与测试 harness 中挂载。

已知局限（round-trip 差异已在 `roundtrip.test.ts` 登记）：

1. 转义的字面 `\[^1]`：解析侧把源切片做去转义对齐并按位标记转义，
   字面方括号保持转义、与活引用同段也能区分；但当所在文本以空白结尾且不含
   `*_\\` 等 markdown 字符时，Milkdown text 序列化 fast path 会原样输出、
   丢失转义——转义字面在保存后变为活引用，之后稳定（已在 roundtrip.test.ts
   登记 R1）。
2. 行首悬空 `[^1]`（后无任何字符且尚未写定义）暂停键入超过 300ms 时，
   序列化会转义为 `\[^1]`；继续键入后续字符会自动转回引用节点。
3. 键入侧定义块转换只识别文档顶层段落；blockquote/列表内的定义仍可从
   Markdown 解析得到（走 remark-gfm），但不会被键入规则自动创建。

### 3.7 粘贴处理（`packages/editor/src/paste.ts`）

```ts
export type OnPasteAsset = (base64: string, mime: string) => Promise<string> // 调用方回调：保存剪贴板图片，返回 Markdown 相对路径
export type PasteRule = {
  run(slice: Slice, view: EditorView, isPlainText: boolean): Slice
  priority?: number
}
export function getHtmlToMarkdown(): Promise<(html: string) => string> // 离屏 Milkdown 管线 HTML → Markdown（同一 schema，无第二套转换器）
export function createPasteRule(): PasteRule // 有选中文本 + 纯文本 URL → [文字](url)
export function createPastePlugin(getOnPasteAsset: () => OnPasteAsset | undefined): Plugin // 剪贴板图片文件 → onPasteAsset → 插入 ![](相对路径)
```

`text/html` 粘贴由 ProseMirror 默认 DOMParser（同一 schema）处理；图片存盘经
`asset:save` IPC（见 7 节，`electron/preload` 的 `saveAsset`）。三者均已在
`EditorHost.tsx` 插件链挂载，无需业务方手动接线。

### 3.8 会话级撤销持久化（`packages/editor/src/session-history.ts`）

```ts
export interface SerializedTransaction {
  steps: unknown[]
  time: number
}
export interface SessionHistoryRecord {
  baseMarkdown: string
  transactions: SerializedTransaction[]
}
export const sessionRecorderKey: PluginKey<SerializedTransaction[]>
export const sessionRecorderPlugin: Plugin<SerializedTransaction[]>
export function saveHistory(docId: string, record: SessionHistoryRecord): void
export function loadHistory(docId: string): SessionHistoryRecord | null
export function clearHistory(docId: string): void
export function buildSessionHistory(state: EditorState, baseMarkdown: string): SessionHistoryRecord
export function restoreSessionHistory(
  record: SessionHistoryRecord,
  view: EditorView,
  options?: RestoreSessionOptions,
): void
```

Milkdown history key 不导出且 HistoryState 不可序列化，会话撤销以 step JSON
重放重建撤销/重做栈（已知偏离 #6）；重放/恢复期间 recorder 抑制记录并在完成后
重置状态，避免基线污染（已知偏离 #7）。存储为进程内 Map（会话级，非持久盘）。

### 3.9 SourceEditor — CodeMirror 6 源码模式（`packages/editor/src/source-editor.tsx`）

```ts
export interface SourceEditorHandle {
  getText(): string
  flushNow(): void
  getSelectionOffsets(): { anchor: number; head: number } // CM doc 内偏移 = Markdown offset
  setSelectionOffsets(anchor: number, head: number): void // 超界 clamp
  focus(): void
  getScrollRatio(): number
}

export interface SourceEditorProps {
  initialMarkdown: string // 仅 mount 读取一次
  onMarkdownChange(markdown: string): void
  onReady?(handle: SourceEditorHandle): void
  initialScrollRatio?: number // 仅 mount 读取一次（滚动比例恢复）
}
```

内部维护独立的 300ms 防抖 sync（与 EditorHost 同契约）；CM 扩展 = markdown
语言 + language-data 懒加载高亮 + defaultHighlightStyle。

### 3.10 code block NodeView（`packages/editor/src/code-block-view.ts`）

自建 vanilla-TS CM6 NodeView（ADR-5：官方 `@milkdown/kit/component/code-block`
内嵌 Vue app，禁用）。行为：

- 语言 `select`（preset 列表 + 动态补登记未收录 fence 语言，外部更新恢复时同样补 option）+ 复制按钮（1.5s 后复位文案）。
- CM 变更实时写回 PM node（Markdown Buffer 唯一事实源）；PM→CM 全量替换时保留 CM 光标/选区（偏移 clamp 到新文档末尾），不回落行首。
- ArrowUp/ArrowDown/Escape 在块边界经 PM 选区退出（clean-room maybeEscape 语义）。
- 高亮经 `LanguageDescription.load()` 懒加载 + Compartment 重配。
- 焦点路由：PM 选区进入代码块而 DOM 焦点仍留在 PM 根节点时，把焦点与等价光标位交给 CM（`selectionchange` 兜底 + PM plugin），否则键入/IME 文本会写进未聚焦的 CM DOM 而丢失（fence 输入规则 / 代码块 IME e2e 回归）。

### 3.11 table-commands（`packages/editor/src/table-commands.ts`）

```ts
export type TableCommand = (
  ctx: Ctx,
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
) => boolean

export const addRowAbove: TableCommand
export const addRowBelow: TableCommand
export const addColumnLeft: TableCommand
export const addColumnRight: TableCommand
export const deleteTableRow: TableCommand
export const deleteTableColumn: TableCommand
```

- 光标在表格单元格内时基于 `selectedRect` 定位；全部命令**单事务 dispatch**（一次撤销恢复完整状态）。
- 行列新增命令成功后把光标移入新行 / 新列（Ruling-2，Typora 行为）；`deleteTableRow` 后光标保持原列。
- 对齐保留：`addRow*` 复用 gfm `addRowWithAlignment`（新行继承表头列对齐）；`addColumn*` 复制相邻列对齐（新列为左对齐 `:-`）。序列化差异逐条登记在 `table-commands.test.ts`（R1 注释 + `toBe` 精确断言）。
- 保护语义：光标不在表格内时全部返回 false；`deleteTableRow` 在表头行（`rect.top === 0`）或表只剩表头时返回 false（**表头行禁删**）；`deleteTableColumn` 在 `map.width <= 1` 时返回 false（**单列禁删列**）。
- 列宽（colwidth）是 prosemirror-tables 视图层属性，**不持久化进 Markdown**；拖拽列宽后净编辑为零时 Ctrl+S 按铁律 1 跳过写盘（e2e/table.spec.ts 登记该保真性质）。

### 3.12 table-toolbar（`packages/editor/src/table-toolbar.ts`）

自建 vanilla TS 悬浮工具栏（ADR-5 同理：Milkdown 官方 table-block 为 Vue 实现，禁用），以 `$prose` 插件注册到 PM 编辑器。光标进入表格单元格时显示于该表格上方，离开表格 / 编辑器不可编辑时隐藏。按钮 `mousedown` 阻止默认以保护编辑器选区。

6 个按钮的 `data-testid` 与对应命令：

| data-testid                | 命令                |
| -------------------------- | ------------------- |
| `table-toolbar-row-above`  | `addRowAbove`       |
| `table-toolbar-row-below`  | `addRowBelow`       |
| `table-toolbar-col-left`   | `addColumnLeft`     |
| `table-toolbar-col-right`  | `addColumnRight`    |
| `table-toolbar-row-delete` | `deleteTableRow`    |
| `table-toolbar-col-delete` | `deleteTableColumn` |

e2e 通过只读调试钩子 `__mdEditorDebug.getMarkdown()`（EditorHost 注册，无写能力）断言序列化结果。

## 4. 工作台组件（`packages/app`）

| 组件             | Props（摘要）                                                 | 说明                                         |
| ---------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `Workspace`      | `root: string \| null`                                        | 顶层布局；持有 tab 状态、侧栏状态            |
| `TabBar`         | `tabs: Tab[]`, `activeId`, `onSelect/onClose/onReorder`       | 脏标记圆点、中键关闭                         |
| `FileTree`       | `root: string`, `onOpen(path)`                                | 虚拟滚动；数据来自主进程 watcher 增量事件    |
| `OutlinePanel`   | `outline: OutlineNode[]`, `activeHeadingPath`, `onJump(path)` | 由 `parseOutline` 派生，跟随光标高亮         |
| `FindReplaceBar` | `doc: MdDocument`                                             | 替换调用 `doc.replaceText`，不经过编辑器组件 |
| `StatusBar`      | `chars, cursor, mode, savedAt`                                | 只读展示                                     |
| `SettingsDialog` | `settings: Settings, onChange(patch)`                         | JSON schema 驱动渲染                         |
| `ExportDialog`   | `doc: MdDocument`                                             | 调用 `packages/export`                       |
| `ToastHost`      | —                                                             | 右下角，最多 3 条                            |

### 4.1 状态管理（Zustand store 摘要）

```ts
interface AppState {
  tabs: TabInfo[] // { id, path, title, dirty }
  activeTabId: string | null
  sidebar: { visible: boolean; width: number; page: 'files' | 'outline' }
  mode: 'wysiwyg' | 'source'
  settings: Settings
  openFile(path: string): Promise<void>
  closeTab(id: string, force?: boolean): Promise<'closed' | 'cancelled'>
  setMode(m: 'wysiwyg' | 'source'): void
}
```

## 5. 导出管线（`packages/export`）

```ts
export interface ExportInput {
  markdown: string
  themeCss?: string // 内联主题
  assetResolver?: (src: string) => Promise<Uint8Array | null>
}

export type ExportFormat = 'pdf' | 'html' | 'image' | 'docx'

export interface ExportPipeline {
  readonly format: ExportFormat
  run(input: ExportInput, target: string): Promise<void>
}

export const exporters = new Map<ExportFormat, ExportPipeline>()
```

- `pdf`（v1）：渲染进程拼出自包含 HTML → `window.mdEditor.exportPdf()` → 主进程 `webContents.printToPDF()`，**静默导出，无需 headless Chromium**。
- `html`（v1）：渲染进程直接产出单文件内容 → `window.mdEditor.exportHtml()`。
- `image` / `docx`：v1.1（长图走 `capturePage`；docx 依赖本机 pandoc）。

## 6. 主题（`packages/theming`）

```ts
export interface ThemeMeta {
  id: string // 'github-light'
  name: string
  appearance: 'light' | 'dark'
}

export function listThemes(): ThemeMeta[] // 内置 + 用户目录扫描
export function loadThemeCss(id: string): string // 返回 CSS 文本，由 app 注入
export function validateTheme(css: string): ThemeIssue[] // theme:check 与运行时共用
```

## 7. IPC 通道与事件表

| 通道 / 事件            | 方向      | payload                         | 说明                                                                                               |
| ---------------------- | --------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `app:info`             | 渲染 → 主 | —                               | 返回 `{ version, electron }`（M0 已实现）                                                          |
| `doc:read`             | 渲染 → 主 | `{ path }`                      | 返回 `FileContent`（含原始 base64 字节与 EOL/BOM 元信息）                                          |
| `doc:write`            | 渲染 → 主 | `{ path, bytesBase64 }`         | 原子写；返回 `WriteCredential`                                                                     |
| `asset:save`           | 渲染 → 主 | `{ docPath, bytesBase64, ext }` | 写 `<docDir>/assets/<yyyy-MM-dd-HHmmss>-<rand>.<ext>`；返回 `assets/xxx.ext` 相对路径（M1 已实现） |
| `watch:file`           | 渲染 → 主 | `{ path }`                      | 替换当前监听目标（M3 扩展为工作区级）                                                              |
| `app:open-file`        | 主 → 渲染 | `path: string`                  | `--open` CLI 触发（M0 已实现）                                                                     |
| `fs:external-modified` | 主 → 渲染 | `path: string`                  | 非自身写入的变更                                                                                   |
| `export:pdf`           | 渲染 → 主 | `{ html, target }`              | `webContents.printToPDF()`（M4 计划）                                                              |
| `export:html`          | 渲染 → 主 | `{ content, target }`           | 写自包含 HTML（M4 计划）                                                                           |
| `menu:command`         | 主 → 渲染 | `{ id: string }`                | 原生菜单/快捷键转发（M3 计划）                                                                     |

命名约定：invoke 通道用 `域:动作`，事件同名规则；通道字符串集中定义在 `electron/shared/channels.ts`，函数名用 camelCase，避免拼写漂移。
