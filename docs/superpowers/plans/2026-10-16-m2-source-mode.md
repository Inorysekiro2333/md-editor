# M2 — 源码模式与块级组件 实施计划（2026-10-16）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 M2 的 P0 能力——cursor-map 纯函数（mdast 路径 + 偏移互转）、CodeMirror 6 源码模式（双向切换 + 光标精确恢复）、代码块组件（语言选择 / 复制 / 高亮），并顺手完成 M2 登记的两项持续性任务（IPC bytesBase64 守卫、sync.dispose pending flush 语义）。

**Architecture:** cursor-map 以 remark mdast position 为坐标系（Buffer 唯一事实源，remark 是被许可的解析器），通过 PM↔mdast 平行游走（lockstep walk）在纯函数内完成 PM pos ↔ Markdown offset ↔ { path, offset } 互转；源码模式是独立的 CodeMirror 6 组件，与 Milkdown 共用同一 Markdown Buffer（App 层 mode 状态切换，切换前 flush 300ms 防抖）；代码块用自建 CM6 NodeView（Milkdown 官方 code-block 组件是 Vue 实现，禁用，见 Ruling-1）。

**Tech Stack:** Electron 44 + React 18 + TS strict + Milkdown 7.22.3 + CodeMirror 6（@codemirror/state/view/commands/language、@codemirror/lang-markdown、@codemirror/language-data）+ unified 11.0.5 + remark-parse 11.0.0。

**Spec:** `architecture.md` 3.4（光标精确恢复五条口径，验收定义）+ `TODO.md` M2 节 + `development.md` 5/6 节（R1/R2/R3）。

## Global Constraints（摘自 AGENTS.md / handoff，每个任务隐含遵守）

- Markdown Buffer 是唯一事实源；PM Doc 只是投影；源码切换无丢失。
- 零编辑保存不写盘；序列化差异逐条登记（development.md 5 节），禁止静默新增。
- 单内核：渲染 Milkdown、源码/代码块 CodeMirror 6、解析统一 remark/unified；不引入第二套解析器。
- cursor-map 是纯函数：禁 DOM、禁 IO、禁全局可变状态（模块级缓存仅限 immutable parser 实例）。
- TypeScript strict 禁 any；依赖方向 app → editor/export/theming；renderer 不碰 Node/fs。
- 提交信息英文祈使句 + scope（如 `feat(editor): add cursor-map pure functions`）。
- M0/M1 e2e 用例只加不删；`pnpm typecheck` + `pnpm lint` + 相关测试是每个任务的提交硬门槛。
- Windows + PowerShell；文本批量编辑用临时脚本文件（AGENTS 效率规范 4）。
- P1 表格增强不在本计划（Ruling-2：M2b 后续计划）；图片拖拽调整尺寸按 TODO 口径属 v1.1，明确不做。

## Rulings（执行前裁定，违反需回滚重议）

- Ruling-1：代码块 NodeView **不用** `@milkdown/kit/component/code-block`——其实现内嵌 Vue app（已核实 `@milkdown/components/lib/code-block` 导出 Vue DefineComponent），引入第二 UI 框架违反技术栈约束；按 ADR-5 自建 vanilla TS NodeView。
- Ruling-2：本计划范围 = M2 全部 P0 + 两项 M2 顺手持续性任务；P1 表格增强（行列增删/列宽拖拽/对齐保留）留待 M2b 计划，理由：与源码模式子系统独立（writing-plans scope check），且 P0 验收（切换 10 次 + 光标恢复）是独立可交付里程碑。
- Ruling-3：光标选区在 mode 切换时以 **Markdown offset（anchor/head）** 为交换格式，mdast {path, offset} 是 architecture.md 3.4 要求的保存形态，由 cursor-map 提供互转；两者都实现并测试。
- Ruling-4：滚动恢复按 3.4 第 4 条实现为「滚动比例（scrollTop/scrollHeight）恢复」的最小版本；逐块视口比例记录为已知简化，登记在 component-api.md 与 development.md R3。

---

## File Structure（本计划锁定的文件边界）

| 文件                                                         | 职责                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `packages/editor/src/cursor-map.ts`                          | 全部互转纯函数（remark 层 + PM bridge 层）                                 |
| `packages/editor/src/cursor-map.test.ts`                     | cursor-map 单测（node 环境跑 remark 层；jsdom 跑 PM bridge 层）            |
| `packages/editor/src/source-editor.tsx`                      | CodeMirror 6 源码模式组件（React）                                         |
| `packages/editor/src/source-editor.test.ts`                  | 源码组件单测（jsdom）                                                      |
| `packages/editor/src/code-block-view.ts`                     | 代码块 CM6 NodeView（vanilla TS）                                          |
| `packages/editor/src/code-block-view.test.ts`                | NodeView 行为单测（jsdom）                                                 |
| `packages/editor/src/EditorHost.tsx`                         | EditorHandle 扩展（getSelectionOffsets/setSelectionOffsets），不改动插件链 |
| `packages/editor/src/sync.ts`                                | dispose 改为 flush pending（语义变更点）                                   |
| `packages/app/src/App.tsx`                                   | mode 状态、Ctrl+/ 、切换按钮、选区/滚动交接                                |
| `electron/shared/base64.ts`                                  | base64 载荷校验纯函数                                                      |
| `electron/main/*`、`electron/preload/*`                      | doc:write / asset:save 接入守卫（最小改动）                                |
| `e2e/source-mode.spec.ts`、`e2e/code-block.spec.ts`          | R3 验收 e2e + 代码块 e2e                                                   |
| `TODO.md`、`component-api.md`、`development.md`、`DESIGN.md` | 交付后文档对齐                                                             |

---

### Task 1: cursor-map remark 层（Markdown offset ↔ MdCursor）

**Files:**

- Modify: `packages/editor/package.json`（dependencies 增加 `unified@11.0.5`、`remark-parse@11.0.0`、`@types/mdast`（dev）——版本必须与 node_modules/.pnpm 现存一致，禁止升级）
- Create: `packages/editor/src/cursor-map.ts`
- Test: `packages/editor/src/cursor-map.test.ts`

**Interfaces (Produces):**

```ts
export interface MdCursor {
  path: number[]
  offset: number
}
export type CursorAccuracy = 'exact' | 'ancestor'

/** offset = UTF-16 code unit index in markdown string; cursor.offset 相对所解析到的最深 mdast 节点 position.start.offset */
export function mdOffsetToCursor(markdown: string, offset: number): MdCursor
/** 逆向：path 失效时逐级回退到最近可解析祖先并把 offset 归零（块首），永不 throw */
export function cursorToMdOffset(markdown: string, cursor: MdCursor): number
```

语义约定（写进 cursor-map.ts 顶部 doc comment，作为验收定义）：

1. `path[i]` = 第 i 层 mdast 节点在其父节点 children 中的下标；解析目标是「包含该 offset 的最深节点」。
2. 节点边界偏好：offset == child.end 时归入该 child（offset = child.end - child.start）；root 空文档（''）返回 `{ path: [], offset: 0 }`。
3. `cursorToMdOffset` 退化路径 = architecture.md 3.4 第 3 条「最近祖先 + 块首」，必须有登记用例。

- [ ] **Step 1: 写失败测试**（node 环境，无需 jsdom）

```ts
import { describe, expect, it } from 'vitest'
import { cursorToMdOffset, mdOffsetToCursor } from './cursor-map'

describe('mdOffsetToCursor', () => {
  it('maps offset inside a heading text to {path, offset}', () => {
    // '## 你好\n\n正文' → '好' 的 offset = 2 + 2 = 4
    expect(mdOffsetToCursor('## 你好\n\n正文', 4)).toEqual({ path: [0], offset: 3 })
  })
  it('resolves deepest node for nested list', () => {
    const md = '- a\n  - b\n'
    // 'b' 在 mdast list>listItem(1)>paragraph>text，offset 相对 text 起点
    const cursor = mdOffsetToCursor(md, md.indexOf('b'))
    expect(cursor).toEqual({ path: [0, 1, 0, 0], offset: 0 })
  })
  it('returns {path: [], offset: 0} for empty doc', () => {
    expect(mdOffsetToCursor('', 0)).toEqual({ path: [], offset: 0 })
  })
})

describe('cursorToMdOffset', () => {
  it('round-trips with mdOffsetToCursor', () => {
    const md = '# 标题\n\n段落**加粗**文字\n'
    for (let offset = 0; offset < md.length; offset++) {
      const cursor = mdOffsetToCursor(md, offset)
      expect(cursorToMdOffset(md, cursor)).toBe(offset)
    }
  })
  it('degrades to nearest ancestor block start when path is invalid', () => {
    const md = '# 标题\n\n正文\n'
    // path [9] 越界 → 最近祖先（document 无块首语义 → 顶层第 0 块块首= 0）
    expect(cursorToMdOffset(md, { path: [9], offset: 3 })).toBe(0)
    // path [0, 5] 越界（heading 只有 text child）→ 最近祖先 heading 块首 = 0
    expect(cursorToMdOffset(md, { path: [0, 5], offset: 1 })).toBe(0)
  })
})
```

- [ ] **Step 2: 运行确认失败** — `pnpm vitest run packages/editor/src/cursor-map.test.ts`（红）
- [ ] **Step 3: 最小实现**（remark-parse + 手写递归下钻；`unified().use(remarkParse)` 模块级单例；严格类型，mdast 节点用 `RootContent` 联合类型收窄，position 可能 undefined 时按 [0,0] 处理并在 doc comment 登记）
- [ ] **Step 4: 测试转绿** — 同 Step 2（绿）
- [ ] **Step 5: 硬门槛 + 提交** — `pnpm typecheck && pnpm lint` 过后 `git commit -m "feat(editor): add cursor-map mdast offset conversions"`

### Task 2: cursor-map PM bridge（PM pos ↔ Markdown offset / MdCursor）

**Files:**

- Modify: `packages/editor/src/cursor-map.ts`（追加导出）
- Test: `packages/editor/src/cursor-map.test.ts`（新增 `@vitest-environment jsdom` describe 块，复用 `testing/create-test-editor.ts`）

**Interfaces (Produces):**

```ts
export interface PositionResult {
  pos: number
  accuracy: CursorAccuracy
}

export function pmPosToMarkdownOffset(markdown: string, doc: PMNode, pos: number): number
export function markdownOffsetToPmPos(markdown: string, doc: PMNode, offset: number): PositionResult
export function pmPosToMdCursor(markdown: string, doc: PMNode, pos: number): MdCursor
export function mdCursorToPmPos(markdown: string, doc: PMNode, cursor: MdCursor): PositionResult
```

实现算法（PM↔mdast 平行游走，双方都来自同一 buffer，故 child 序列一一对应是主路径）：

1. 块级：逐 child 同步前进（pmChild.nodeSize 对 mdast child 的 position 长度）；kind 明显不对应（如 footnote/html 边角）→ 顶层块级 fallback：按 PM 顶层块序号映射 mdast 顶层块，accuracy='ancestor'。
2. 行内 lockstep 规则：`text↔text`、`inlineCode↔带 code mark 的 text`（等长）、`strong/emphasis/link/delete↔对应 mark 的扁平 text 段`（递归 children，文本总长一致）、`image↔image（PM size 1，mdast 走完整 range）`、`break↔hardBreak`；不匹配时取最近 text 边界，accuracy='ancestor'（平局取后方）。
3. `mdCursorToPmPos` = cursorToMdOffset → markdownOffsetToPmPos；`pmPosToMdCursor` = mdOffsetToCursor∘pmPosToMarkdownOffset（内部单次解析，公共 API 可包一层）。

- [ ] **Step 1: 失败测试**（jsdom；用 `createTestEditor` 建 PM doc，`getView().state.doc` 取 doc，测试用例必须覆盖：标题/段落/嵌套列表/围栏代码块/表格/引用/行内 `**`、`` ` ``、链接、图片、CJK 全角字符、空文档、越界 pos clamp、path 失效 → 'ancestor' 且落在块首）。代表性断言：

````ts
// @vitest-environment jsdom
const md = '# 标题\n\n正文**加粗**继续\n\n```ts\nconst a = 1\n```\n'
const te = await createTestEditor(md)
const doc = te.action((ctx) => ctx.get(editorViewCtx).state.doc)
// PM pos 在「加粗」内部 → markdown offset 必须落在源文本对应字符上
const insideBold =
  /* 在 '加' 前 1 个 PM pos，通过 TextSelection near 构造 */
  expect(pmPosToMarkdownOffset(md, doc, insideBold)).toBe(md.indexOf('加'))
expect(markdownOffsetToPmPos(md, doc, md.indexOf('加'))).toMatchObject({ accuracy: 'exact' })
// 往返：任意 PM pos → offset → PM pos 相等或同义（同为 text 边界）
````

- [ ] **Step 2: 红 → Step 3: 实现 lockstep → Step 4: 绿**（同 Task 1 节奏；往返用例对全文每个 offset/pos 做扫描断言：`mdCursorToPmPos(md, doc, pmPosToMdCursor(md, doc, pos))` 与原 pos 一致或两者都指向同一 text 边界）
- [ ] **Step 5: 硬门槛 + 提交** — `feat(editor): bridge pm positions to markdown offsets`

### Task 3: CodeMirror 6 源码模式组件

**Files:**

- Modify: `packages/editor/package.json`（dependencies：`@codemirror/state@^6`、`@codemirror/view@^6`、`@codemirror/commands@^6`、`@codemirror/language@^6`、`@codemirror/lang-markdown@^6`、`@codemirror/language-data@^6`、`@lezer/highlight@^6`（dev 亦可，按实际 import 归位））
- Create: `packages/editor/src/source-editor.tsx`
- Test: `packages/editor/src/source-editor.test.ts`

**Interfaces (Produces):**

```tsx
export interface SourceEditorHandle {
  getText(): string
  flushNow(): void
  getSelectionOffsets(): { anchor: number; head: number }
  setSelectionOffsets(anchor: number, head: number): void
  focus(): void
  getScrollRatio(): number
}
export interface SourceEditorProps {
  initialMarkdown: string
  onMarkdownChange(markdown: string): void
  onReady?(handle: SourceEditorHandle): void
  initialScrollRatio?: number
}
export function SourceEditor(props: SourceEditorProps): JSX.Element
```

要点：复用 `createMarkdownSync`（updateListener docChanged → schedule；300ms 防抖与 Milkdown 侧一致）；扩展 `EditorView.lineWrapping`；markdown 语法高亮 `markdown({ codeLanguages: languages })`（languages 来自 `@codemirror/language-data`）+ `syntaxHighlighting(defaultHighlightStyle)`；快捷键只装 defaultKeymap + historyKeymap（Ctrl+S 交给 App 全局层，组件内不拦截）。**initialMarkdown 只在 mount 时读取一次**（与 EditorHost 同契约），onMarkdownChange 上抛后由 App 更新 Buffer。

- [ ] **Step 1: 失败测试**（jsdom；CM6 在 jsdom 可运行）：mount 后 getText==initialMarkdown；输入触发 onMarkdownChange；setSelectionOffsets 后 getSelectionOffsets 回读一致；flushNow 立即收敛。
- [ ] **Step 2: 红 → Step 3: 实现 → Step 4: 绿**
- [ ] **Step 5: 硬门槛 + 提交** — `feat(editor): add codemirror source mode component`

### Task 4: 模式切换集成（App + EditorHandle 扩展）

**Files:**

- Modify: `packages/editor/src/EditorHost.tsx`（仅 EditorHandle 扩展 + 内部用 cursor-map；插件链/同步逻辑不动）
- Modify: `packages/editor/src/index.ts`（导出 SourceEditor、cursor-map 公共 API）
- Modify: `packages/app/src/App.tsx`
- Test: `packages/editor/src/mode-switch.test.ts`（cursor capture/restore 纯逻辑单测）

**Interfaces (Produces):**

```ts
export interface EditorHandle {
  getMarkdown(): string
  flushNow(): void
  getSelectionOffsets(): { anchor: number; head: number } | null // 经 cursor-map
  setSelectionOffsets(anchor: number, head: number): void
  getScrollRatio(): number
}
```

App 侧切换流程（唯一事实源纪律）：`toggleMode()` → ① 活动 handle `flushNow()`（PM 侧防抖收敛）→ ② `pendingSelection.current = activeHandle.getSelectionOffsets()` + `pendingScrollRatio` → ③ `setMode(取反)` → ④ 新 handle `onReady` 中 `setSelectionOffsets(anchor, head)` + `applyScrollRatio`。mode 状态存 `useAppStore`（`mode: 'wysiwyg' | source`，初始 wysiwyg）；UI：header 内 `data-testid="mode-toggle"` 按钮（文案 编辑模式：所见即所得 / 源码）+ 全局 `Ctrl+/`（keydown 监听与现有 Ctrl+S 并列）。切换期间 Buffer 文本不变（doc.text 直接作为另一侧 initialMarkdown）。

- [ ] **Step 1: 失败测试**：mode-switch.test.ts 用 createTestEditor 断言 `getSelectionOffsets` 在标题中段往返 `setSelectionOffsets` 后 selection anchor 相等（精确恢复=exact 的 PM 侧单测证据）。
- [ ] **Step 2: 红 → Step 3: 实现（EditorHost + App 接线）→ Step 4: 绿 + `pnpm build:app` 通过**
- [ ] **Step 5: 硬门槛 + 提交** — `feat(app): toggle wysiwyg and source mode with cursor restore`

### Task 5: R3 验收 e2e（切换 10 次 + 零编辑不写盘）

**Files:**

- Create: `e2e/source-mode.spec.ts`

用例（只加不删）：

1. 打开含标题/列表/表格/代码围栏的 fixture（e2e/fixtures 已有目录，可新增 `source-mode.md`），点击正文中间 → `Ctrl+/` 往返切换 10 次：每次断言 ① 编辑器可见文本 == 文件内容；② caret 的绝对字符 offset 不变（helper：`window.getSelection` 遍历文本节点算 offset，PM 与 CM 的 contenteditable 都适用）。
2. 切换后零编辑 Ctrl+S：文件 mtime+size 不变（零编辑不写盘在源码模式下同样成立）。
3. 源码模式编辑 → 切回 WYSIWYG：内容同步无丢失（flush 语义验证）。

- [ ] **Step 1: 写 spec → Step 2: `pnpm e2e` 红/绿按 TDD → Step 3: 全量 `pnpm e2e` 过（27 + 新增）**
- [ ] **Step 4: 硬门槛 + 提交** — `test(e2e): add source mode round-trip acceptance`

### Task 6: 代码块组件（CM6 NodeView：语言选择 / 复制 / 高亮）

**Files:**

- Create: `packages/editor/src/code-block-view.ts`（`$view` 挂 commonmark `codeBlockSchema`；语言表来自 `@codemirror/language-data`，按 `LanguageDescription.matchLanguages` 懒加载高亮）
- Modify: `packages/editor/src/EditorHost.tsx`（`.use(codeBlockView)` 挂载；插件链其余不动）
- Modify: `packages/editor/src/roundtrip.test.ts`（按 development.md 5 节登记：fence 语言保留 / 空代码块 / 无语言 fence / 内容含 ``` 的边界；仅补缺失用例，已登记的禁止改期望值）
- Modify: `packages/app/src/app.css` + `DESIGN.md`（`.md-codeblock` chrome 样式 + CSS 变量登记）
- Test: `packages/editor/src/code-block-view.test.ts`；Create: `e2e/code-block.spec.ts`

NodeView 设计（vanilla TS，无 React/Vue）：`dom = div.md-codeblock`；header = `<select class="md-codeblock-lang">`（plain text + 常用语言）+ `<button class="md-codeblock-copy">`（`navigator.clipboard.writeText`，成功后 1.5s 文案「已复制」）；body = CM6 EditorView（初值 node.textContent，change→dispatch PM transaction 替换 code 内容；PM→CM 用 update(node) 单向同步 + updating 防回环；`maybeEscape` 模式让 Ctrl/方向键能退出代码块）。CM 初次挂载后 focus 保持 PM 选区语义。

- [ ] **Step 1: 失败单测**（jsdom：NodeView 渲染出 select+button+cm-editor；改语言 → node.attrs.language 变化且序列化 fence 更新；复制按钮调用 clipboard mock；CM 输入 → PM doc 更新）
- [ ] **Step 2: 红 → Step 3: 实现 + roundtrip 登记 → Step 4: 绿**
- [ ] **Step 5: e2e**：code-block.spec.ts——打开含 ```ts 围栏文档，断言语言选择器显示 ts、复制按钮存在、在代码块内键入新行并保存后文件内容一致；代码块内输入规则不误触（R2 关联，CDP 模拟可选，真人 IME 手测保持待补并登记）。
- [ ] **Step 6: 硬门槛 + 提交** — `feat(editor): add code block node view with language picker and copy`

### Task 7: M2 顺手项（IPC base64 守卫 + sync.dispose flush 语义）

**Files:**

- Create: `electron/shared/base64.ts` + `electron/shared/base64.test.ts`
- Modify: `electron/main/fs_io.ts`（或实际 IPC handler 文件，先读再改）、`electron/preload/index.ts`（仅当类型收窄需要）
- Modify: `packages/editor/src/sync.ts`、`packages/editor/src/sync.test.ts`

语义决定（按 handoff §5 登记）：`doc:write` / `asset:save` 收到非 string / 非法 base64 / 超限（doc 10MB、asset 20MB）载荷时**干净拒绝**（Error('invalid payload')），不写盘；`createMarkdownSync.dispose()` 改为 **先同步 flush pending 再清理**（unmount 时不再丢 Buffer 收敛；session-history 重放仍兜底）。两处语义均写入 component-api.md。

- [ ] **Step 1: 失败测试**（base64：合法/非法/超限三类；sync.test.ts：schedule→dispose→onFlush 收到）
- [ ] **Step 2: 红 → Step 3: 实现 → Step 4: 绿**
- [ ] **Step 5: 硬门槛 + 提交** — `fix(electron): guard base64 ipc payloads` 与 `fix(editor): flush pending sync on dispose`（两个提交）

### Task 8: 文档对齐 + 里程碑收口

**Files:**

- Modify: `TODO.md`（M2 勾选 + 验收记录：typecheck/lint/test/e2e 实测数字；P1 表格增强标注「M2b 计划」）
- Modify: `component-api.md`（cursor-map API、SourceEditor、mode 切换与选区/滚动语义、code block NodeView、sync.dispose 语义变更）
- Modify: `development.md`（6 节 R3 记录 e2e 结果；R2 登记代码块 IME 结论；7 节性能基准补 M2 实测）
- Modify: `DESIGN.md`（代码块 chrome 变量；若 Task 6 已做则此处仅校对）

- [ ] **Step 1: 按实测数字更新文档（禁止编造数字）**
- [ ] **Step 2: 终验**：`pnpm typecheck && pnpm lint && pnpm test && pnpm e2e && pnpm build:app` 全绿并记录关键数字
- [ ] **Step 3: 提交** — `docs: record m2 source mode milestone`

## Self-Review 记录

- 覆盖检查：architecture.md 3.4 五条 → Task 1/2/3/4/5（第 4 条滚动=Ruling-4 简化版并登记）；TODO M2 P0 三项 → Task 1-6；handoff §5 两项顺手 → Task 7；R1/R2/R3 → Task 6/5/6 与文档任务。
- 类型一致性：EditorHandle/SourceEditorHandle 接口在 Task 3/4 的 Produces 已对齐（anchor/head markdown offset 语义统一）。
- 占位符扫描：无 TBD；「先读再改」仅指实现顺序约束，不是占位。

## Execution Ledger（subagent-driven 执行记录）

- Task 1: complete — commit 0b86ebc — review Approved（10/10）。偏离：计划示例期望值 2 处按真实 remark 结构修正（语义未变）。
- Interlude: 并行会话把 checkout 切到 main 并合入 codex/fix-ime-ci（dc36762，IME e2e 修复，非本会话产物）。Ruling: 不回退，merge main 进本分支（7ba22ac）。
- Task 2: complete — commit 091d52a — review Approved（cursor-map 23/23，全量 142/142）。偏离：① cursor-map parser 加 remark-gfm@4.0.1（与 Milkdown transformer 同管线，否则表格必 fallback）；② 全文扫描断言改为「pos→cursor→pos 往返 + offset→pos exact 保持性」双扫描（强于计划要求）。
- Task 2 parked findings（Ruling: 非阻塞，推迟到 Task 8 前清理波；保守行为无错报 exact 风险）：
  - cursor-map.ts:351-356 原子节点分支未校验 leaf.kind（建议补检查走 fallback）。
  - cursor-map.ts:425-427 anchorsByMd 去重可能用非 exact 锚点遮蔽 exact 锚点（仅多报 ancestor，不会错报 exact）。
- Task 3: complete — commit 092ed12 — review Approved（source-editor 6/6，cursor-map 23/23 无回归，typecheck 0）。偏离：defaultHighlightStyle 改从 @codemirror/language 导入（@lezer/highlight 无此导出）、补 @types/react-dom devDep、setSelectionOffsets 超界 clamp。Parked findings（P2，Task 4 顺手）：source-editor.tsx:60 effect 依赖 initialScrollRatio 运行期变化会重建 view 并从 mount 值重置 doc（Task 4 用法不触发）——改 ref/只 mount 一次。
- Task 4: complete — commit 599b80c — review Approved（editor+app 135/135，typecheck 0，build:app 成功）。偏离：@milkdown/prose/state 无 EditorSelection 导出改用 TextSelection.create；getScrollRatio 结构化 cast；未就绪降级置空 pending。Parked finding（source-editor.tsx:60 initialScrollRatio）已在本任务修复并有回归测试。
- Task 5: complete — commits 451f205（e2e）+ a6bb502（光标恢复产品修复）+ b84d51e（fix round 1）— review fix round 1/5 → scoped re-review All findings addressed（vitest 136/136，e2e source-mode 3/3，全量 e2e 30 passed）。偏离：① 修复 3 个阻塞 bug（onReady 时光标恢复空转→initialSelection prop；块级边界 TextSelection 异常→near(+1) 块首语义+登记用例；Ctrl+/ 被 CM 注释切换抢占→capture+stopPropagation）；② WYSIWYG 可见文本为渲染 DOM，断言改为「源码模式==文件内容 + 两模式文本/caret 稳定 + 跨模式 caret 等值」。
