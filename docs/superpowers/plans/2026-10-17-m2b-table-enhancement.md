# M2b 表格增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 M2 补齐 P1 表格增强：行列增删 UI、列宽拖拽、对齐保留（序列化零静默变化）。

**Architecture:** 命令层 `table-commands.ts` 直接复用 gfm 内置的 `addRowWithAlignment`（新行继承列对齐）与 prosemirror-tables（`CellSelection` + `deleteRow`/`deleteColumn`/`addColumn*`），单事务 dispatch 保证撤销粒度；UI 层 `table-toolbar.ts` 是自建 vanilla TS 悬浮工具栏（Milkdown 官方 table-block 是 Vue 实现，禁用，与 code-block Ruling-1 同理），以 `$prose` 插件注册；列宽拖拽复用 gfm 已启用的 `columnResizing` 插件，只补 CSS 与保真测试——colwidth 是视图层属性，绝不序列化进 Markdown。

**Tech Stack:** Milkdown 7.22.3（gfm preset 自带 tableEditing/columnResizing/keepTableAlign + 命令）、prosemirror-tables 1.8.5（经 `@milkdown/prose/tables`）、Vitest（jsdom）、Playwright（Electron）。

**Spec:** TODO.md「M2 P1 表格增强」+ 交接文档 docs/superpowers/handoffs/2026-10-16-m2-p0-done-m2b-start.md §6。铁律见 AGENTS.md（Buffer 唯一事实源、R1 差异登记、e2e 教训 6 条、AI 执行效率 7 条）。

## Global Constraints

- 序列化差异必须逐条登记为 R1 用例（`// Registered normalization (R1): ...` + `toBe` 精确断言），禁止 `toMatch`。
- 禁止引入第二套编辑器内核；禁用任何 Vue 实现的 Milkdown component（含 `@milkdown/kit/component/table-block`）。
- TypeScript strict，禁 any（测试文件内如需逃生舱用 `as unknown as`）。
- 依赖方向：`app → editor`；新代码全部放 `packages/editor`，CSS 放 `packages/app/src/app.css`。
- e2e 光标/内容断言用编辑器状态真值（`__mdEditorDebug`），先等 `[data-editor-ready="true"]`；e2e 只加不删。
- 提交信息英文祈使句 + scope（`feat(editor): ...`）。
- 共享 checkout 警告：子代理禁止切分支、禁止 push；直接在当前分支提交。
- 命令必须单事务 dispatch（一次撤销恢复完整状态）；Buffer 收敛沿用现有 300ms 防抖，不改 sync。

---

### Task 1: 命令层 table-commands + 保真测试

**Files:**

- Create: `packages/editor/src/table-commands.ts`
- Test: `packages/editor/src/table-commands.test.ts`

**Interfaces:**

- Produces（Task 2 依赖）:

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

  语义：光标在表格单元格内时基于 `selectedRect` 定位；`deleteTableRow` 在 `rect.top === 0`（表头行）或表只剩表头时返回 false；`deleteTableColumn` 在 `map.width <= 1` 时返回 false；不在表格内全部返回 false。

- [ ] **Step 1: 写失败测试**（文件顶部加 `// @vitest-environment jsdom`）

用例输入与真实期望输出（2026-10-17 已用 scratch 实测验证）：

```ts
const ALIGNED = '| a | b |\n| :--- | ---: |\n| 1 | 2 |\n| 3 | 4 |\n'
// 光标置入单元格 helper：doc.descendants 找 textContent === 目标文本的 textblock，
// TextSelection.create(doc, pos + 1) 后 view.dispatch。
```

断言（全部 `toBe` 精确值，helper `runCommand(cmd, cellText)` 内用 `editor.action` 执行 `cmd(ctx, view.state, tr => view.dispatch(tr))`）：

1. addRowBelow（光标在 `1`）→
   `'| a  |  b |\n| :- | -: |\n| 1  |  2 |\n|    |    |\n| 3  |  4 |\n'`
   // Registered normalization (R1): cell padding（M1 已登记）；新行单元格继承表头列对齐，分隔行不变。
2. addRowAbove（光标在 `3`）→
   `'| a  |  b |\n| :- | -: |\n| 1  |  2 |\n|    |    |\n| 3  |  4 |\n'`
3. addColumnRight（光标在 `2`）→
   `'| a  |  b |    |\n| :- | -: | :- |\n| 1  |  2 |    |\n| 3  |  4 |    |\n'`
   // Registered normalization (R1): 新列复制相邻列对齐 → 左对齐标记 `:-`（prosemirror-tables addColumnAfter 行为）。
4. addColumnLeft（光标在 `1`）→
   `'|    | a  |  b |\n| :- | :- | -: |\n|    | 1  |  2 |\n|    | 3  |  4 |\n'`
5. deleteTableRow（光标在 `3`）→ `'| a  |  b |\n| :- | -: |\n| 1  |  2 |\n'`
6. deleteTableColumn（光标在 `2`）→ `'| a  |\n| :- |\n| 1  |\n| 3  |\n'`
7. deleteTableRow 光标在表头 `a` → 返回 false，markdown 与输入序列化结果逐字相等（`'| a  |  b |\n| :- | -: |\n| 1  |  2 |\n| 3  |  4 |\n'`）。
8. deleteTableColumn 在单列表格 `'| a |\n| - |\n| 1 |\n'` → 返回 false，markdown 不变。
9. 光标在普通段落 → 全部 6 个命令返回 false。
10. 给所有 cell setNodeMarkup `colwidth: [123]` → getMarkdown 与第 7 步期望值逐字相等。
    // Registered note (R1): colwidth 是视图层属性，不序列化进 Markdown——列宽拖拽不改盘。

- [ ] **Step 2: 跑测试确认失败** — `pnpm vitest run packages/editor/src/table-commands.test.ts`，Expected: FAIL（模块不存在）。
- [ ] **Step 3: 最小实现**

```ts
import type { Ctx } from '@milkdown/kit/ctx'
import { addRowWithAlignment } from '@milkdown/kit/preset/gfm'
import type { EditorState, Transaction } from '@milkdown/prose/state'
import {
  CellSelection,
  addColumnAfter,
  addColumnBefore,
  deleteColumn,
  deleteRow,
  isInTable,
  selectedRect,
} from '@milkdown/prose/tables'

export type TableCommand = (
  ctx: Ctx,
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
) => boolean

function rowSelection(state: EditorState, row: number): CellSelection {
  const rect = selectedRect(state)
  const anchor = state.doc.resolve(rect.tableStart + rect.map.positionAt(row, 0, rect.table))
  const head = state.doc.resolve(
    rect.tableStart + rect.map.positionAt(row, rect.map.width - 1, rect.table),
  )
  return CellSelection.rowSelection(anchor, head)
}

function columnSelection(state: EditorState, col: number): CellSelection {
  const rect = selectedRect(state)
  const anchor = state.doc.resolve(rect.tableStart + rect.map.positionAt(0, col, rect.table))
  const head = state.doc.resolve(
    rect.tableStart + rect.map.positionAt(rect.map.height - 1, col, rect.table),
  )
  return CellSelection.colSelection(anchor, head)
}

export const addRowAbove: TableCommand = (ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  if (dispatch) {
    const rect = selectedRect(state)
    dispatch(addRowWithAlignment(ctx, state.tr, rect, rect.top))
  }
  return true
}

export const addRowBelow: TableCommand = (ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  if (dispatch) {
    const rect = selectedRect(state)
    dispatch(addRowWithAlignment(ctx, state.tr, rect, rect.bottom))
  }
  return true
}

export const addColumnLeft: TableCommand = (_ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  return addColumnBefore(state, dispatch)
}

export const addColumnRight: TableCommand = (_ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  return addColumnAfter(state, dispatch)
}

export const deleteTableRow: TableCommand = (_ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  const rect = selectedRect(state)
  if (rect.top === 0 || rect.map.height <= 1) return false
  const selection = rowSelection(state, rect.top)
  const tr = state.tr.setSelection(selection)
  // prosemirror-tables deleteRow 读取 state.selection/state.tr；单事务完成（选择+删除同 tr）。
  const fakeState = { doc: state.doc, tr, selection } as unknown as EditorState
  return deleteRow(fakeState, dispatch)
}

export const deleteTableColumn: TableCommand = (_ctx, state, dispatch) => {
  if (!isInTable(state)) return false
  const rect = selectedRect(state)
  if (rect.map.width <= 1) return false
  const selection = columnSelection(state, rect.left)
  const tr = state.tr.setSelection(selection)
  const fakeState = { doc: state.doc, tr, selection } as unknown as EditorState
  return deleteColumn(fakeState, dispatch)
}
```

注意：`@milkdown/kit/ctx` 的 `Ctx` 类型若导出路径不同，改用 `Parameters<Parameters<import('@milkdown/kit/core').Editor['action']>[0]>[0]`（与 testing/create-test-editor.ts 同法）。

- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令，Expected: 10 用例全绿。
- [ ] **Step 5: Commit** — `git add packages/editor/src/table-commands.ts packages/editor/src/table-commands.test.ts && git commit -m "feat(editor): add table row/column commands with alignment preservation"`

### Task 2: table-toolbar 悬浮工具栏（vanilla TS）+ 注册 + CSS

**Files:**

- Create: `packages/editor/src/table-toolbar.ts`
- Modify: `packages/editor/src/index.ts`（追加导出 `tableToolbar`）
- Modify: `packages/editor/src/EditorHost.tsx`（`.use(gfm)` 后追加 `.use(tableToolbar)`；`__mdEditorDebug` 追加只读 `getMarkdown`——本任务先加，Task 3 e2e 使用）
- Modify: `packages/editor/src/testing/create-test-editor.ts`（第三可选参数 `milkdownPlugins: MilkdownPlugin[] = []`，`.use(...milkdownPlugins)`）
- Modify: `packages/app/src/app.css`（工具栏 + resize handle 样式）
- Test: `packages/editor/src/table-toolbar.test.ts`

**Interfaces:**

- Consumes: Task 1 的 6 个 `TableCommand`。
- Produces:

  ```ts
  export const tableToolbar: MilkdownPlugin // $prose 插件
  // DOM: div.md-table-toolbar[data-testid="table-toolbar"]，六个 button[data-testid]:
  // table-toolbar-row-above / row-below / col-left / col-right / row-delete / col-delete
  // __mdEditorDebug 增加只读 getMarkdown(): string
  ```

- [ ] **Step 1: 写失败测试**（`// @vitest-environment jsdom`）

```ts
const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n'
// createTestEditor(TABLE, [], [tableToolbar])
// 1. 光标置入单元格 '1' 后 document.querySelector('[data-testid="table-toolbar"]') 非 null 且可见。
// 2. 点击 [data-testid="table-toolbar-row-below"] → getMarkdown() ===
//    '| a | b |\n| - | - |\n| 1 | 2 |\n|   |   |\n'
//    （jsdom 定位代码不得抛错；getBoundingClientRect 为 0 时仍渲染）。
// 3. 选区移到表格外段落 → toolbar 从 DOM 移除（display:none 或 remove，实现自定，断言不可见/不存在）。
// 4. 点击 [data-testid="table-toolbar-row-delete"] 在只剩表头行时无操作且不抛错。
```

- [ ] **Step 2: 跑测试确认失败** — `pnpm vitest run packages/editor/src/table-toolbar.test.ts`。
- [ ] **Step 3: 实现 table-toolbar.ts**

```ts
import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { isInTable, selectedRect } from '@milkdown/prose/tables'
import {
  addColumnLeft,
  addColumnRight,
  addRowAbove,
  addRowBelow,
  deleteTableColumn,
  deleteTableRow,
  type TableCommand,
} from './table-commands'

export const tableToolbarPluginKey = new PluginKey('md-table-toolbar')

type Ctx = Parameters<Parameters<import('@milkdown/kit/core').Editor['action']>[0]>[0]

const BUTTONS: Array<{ id: string; label: string; cmd: TableCommand }> = [
  { id: 'table-toolbar-row-above', label: '↑行', cmd: addRowAbove },
  { id: 'table-toolbar-row-below', label: '↓行', cmd: addRowBelow },
  { id: 'table-toolbar-col-left', label: '←列', cmd: addColumnLeft },
  { id: 'table-toolbar-col-right', label: '→列', cmd: addColumnRight },
  { id: 'table-toolbar-row-delete', label: '删行', cmd: deleteTableRow },
  { id: 'table-toolbar-col-delete', label: '删列', cmd: deleteTableColumn },
]

export const tableToolbar = $prose((ctx: Ctx) => {
  let toolbar: HTMLElement | null = null
  let view: EditorView | null = null
  const run = (cmd: TableCommand): void => {
    if (!view) return
    view.focus()
    cmd(ctx, view.state, (tr) => view?.dispatch(tr))
  }
  return new Plugin({
    key: tableToolbarPluginKey,
    view(editorView) {
      view = editorView
      toolbar = document.createElement('div')
      toolbar.className = 'md-table-toolbar'
      toolbar.setAttribute('data-testid', 'table-toolbar')
      for (const b of BUTTONS) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.textContent = b.label
        btn.setAttribute('data-testid', b.id)
        btn.addEventListener('mousedown', (e) => e.preventDefault()) // 防止抢走编辑器选区
        btn.addEventListener('click', () => run(b.cmd))
        toolbar.appendChild(btn)
      }
      editorView.dom.parentElement?.appendChild(toolbar)
      const sync = (v: EditorView): void => {
        if (!toolbar) return
        if (!v.editable || !isInTable(v.state)) {
          toolbar.style.display = 'none'
          return
        }
        toolbar.style.display = 'flex'
        const rect = selectedRect(v.state)
        const dom = v.domAtPos(rect.tableStart)
        const tableEl =
          (dom.node instanceof Element ? dom.node : dom.node.parentElement)?.querySelector(
            'table',
          ) ?? null
        const box = tableEl?.getBoundingClientRect()
        if (box && box.width > 0) {
          toolbar.style.left = `${Math.round(box.right - toolbar.offsetWidth)}px`
          toolbar.style.top = `${Math.round(box.top - 28)}px`
        }
      }
      sync(editorView)
      return {
        update(v) {
          sync(v)
        },
        destroy() {
          toolbar?.remove()
          toolbar = null
          view = null
        },
      }
    },
  })
})
```

- [ ] **Step 4: 注册与导出** — index.ts `export { tableToolbar, tableToolbarPluginKey } from './table-toolbar'`；EditorHost `.use(gfm)` 之后 `.use(tableToolbar)`；`__mdEditorDebug` 对象追加 `getMarkdown: () => editor.action(getMarkdown())`（getMarkdown 已在文件顶部导入）。app.css 追加：

```css
.md-table-toolbar {
  position: fixed;
  z-index: 30;
  display: none;
  gap: 2px;
  padding: 2px;
  background: var(--bg);
  border: 1px solid #d0d7de;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(31, 35, 40, 0.15);
}
.md-table-toolbar button {
  border: none;
  background: transparent;
  padding: 2px 6px;
  font-size: 12px;
  cursor: pointer;
  color: var(--fg);
  border-radius: 4px;
}
.md-table-toolbar button:hover {
  background: rgba(31, 35, 40, 0.08);
}
.milkdown .column-resize-handle {
  position: absolute;
  right: -2px;
  top: 0;
  bottom: -1px;
  width: 4px;
  cursor: col-resize;
  z-index: 20;
}
.milkdown .resize-cursor {
  cursor: col-resize;
}
```

- [ ] **Step 5: 跑测试确认通过** + `pnpm typecheck && pnpm lint` 全过。
- [ ] **Step 6: Commit** — `feat(editor): add floating table toolbar with row/column controls`

### Task 3: e2e table.spec.ts

**Files:**

- Create: `e2e/table.spec.ts`

**Interfaces:** Consumes Task 2 的 testid、`__mdEditorDebug.getMarkdown()`（只读）、`[data-editor-ready="true"]` 门控。

- [ ] **Step 1: 写 e2e**（沿用 code-block.spec.ts 的 `launchApp` 模式：mkdtempSync + `--open` + `MD_EDITOR_USER_DATA`）

```ts
const CONTENT = '| a | b |\n| :--- | ---: |\n| 1 | 2 |\n| 3 | 4 |\n'
```

用例 1（单例覆盖增删全链路）：

1. 等 `[data-editor-ready="true"]`；点击含 `1` 的单元格。
2. `expect(toolbar).toBeVisible()`。
3. 点击 row-below → `__mdEditorDebug.getMarkdown()` 返回值 `toContain('|    |    |')`（debug 钩子在 evaluate 回调内调用、只返回字符串，遵守 AGENTS 教训 1/2）。
4. 点击 col-right → markdown `toContain('| :- |')` 出现新列标记（对新列 `:-` 的登记差异，断言注释引用 R1）。
5. 点击 row-delete → 新行消失（`not.toContain('|    |    |')`）。
6. 点击 col-delete → 列数回到 2（markdown 与初始序列化 `'| a  |  b |\n| :- | -: |\n| 1  |  2 |\n| 3  |  4 |\n'` 相等——用 evaluate 返回字符串 toBe）。
7. Ctrl+S 保存 → 全链路净编辑为零（行/列增删互相抵消，最终 PM doc 与初始 doc 结构相等），铁律 1「零编辑保存不写盘」生效：状态栏「无改动，已跳过写盘」，磁盘逐字保留原始 CONTENT（对齐规范化不静默落盘）。

用例 2（列宽拖拽不改盘）：

1. 点击表头单元格 → 等 toolbar 可见。
2. 定位第一个 `.column-resize-handle`（在表头 th 内），`boundingBox()` 记录前值。
3. `mouse.move` 到 handle 中心 → `mouse.down()` → `mouse.move(+40px, {steps: 8})` → `mouse.up()`。
4. 断言：表格第一列宽度变化（任一 `th` boundingBox 宽度 +40±10 或表格总宽变化），且 `__mdEditorDebug.getMarkdown()` 与拖拽前逐字相等（colwidth 不序列化，R1 登记）。
5. Ctrl+S 后磁盘内容仍为初始序列化值。

注意：拖拽若 CI 不稳，允许重试一次 mouse 序列（`test.setTimeout(30_000)`），禁止删断言。

- [ ] **Step 2: 本地跑绿** — `pnpm build:app && pnpm e2e -- --grep table`（具体过滤按 playwright.config.ts 实际参数调整，先看文件）。
- [ ] **Step 3: Commit** — `test(e2e): cover table row/column editing and column resize fidelity`

Ruling-2/3（2026-10-17）：行列新增命令光标移入新行/列；EditorHost 显式注册 columnResizingPlugin；deleteTableRow 后光标保持原列（否则全链路 col-delete 会误删第 1 列）；th/td 需 position:relative，否则 resize handle 脱离单元格无法拖拽；Task 3 步骤 7 更正：净编辑为零时按铁律 1 跳过写盘（listener 对 eq 文档不发射，buffer 不收敛属预期保真行为）。

### Task 4: 文档登记 + 全量门禁

**Files:**

- Modify: `component-api.md`（新增 table-toolbar / table-commands 小节：导出、testid 清单、colwidth 不持久化说明、表头行禁删）
- Modify: `TODO.md`（M2 P1 表格增强置 `[x]`；M2 验收记录追加 M2b 数字）
- Modify: `development.md` 6 节 R1（追加一行：表格行列增删/列宽拖拽的序列化登记位置 = table-commands.test.ts 与 e2e/table.spec.ts）
- Modify: 本计划文件（Execution Ledger）

- [ ] **Step 1: 文档编辑**（对照 AGENTS「跨文档事实速查」，不新增里程碑口径）
- [ ] **Step 2: 全量门禁** — 依次 `pnpm typecheck`（0 错误）→ `pnpm lint`（全过）→ `pnpm test`（全绿，新增用例计入）→ `pnpm build:app`（成功）→ `pnpm e2e`（全绿，含新增 table 用例）。
- [ ] **Step 3: Commit** — `docs: register m2b table enhancement in api and todo`
- [ ] **Step 4: Ledger 追加** — 每任务记录 commit、review 结论、偏离与 Ruling。

## Self-Review

- 覆盖检查：TODO M2 P1 三要素 → 行列增删=Task 1+2+3，列宽拖拽=Task 2 CSS+Task 3 用例 2，对齐保留=Task 1 用例 1-8+Task 3 用例 1。handoff §6 全覆盖；R1 登记每处差异都有注释+toBe。
- 占位符扫描：无 TBD/「适当处理」；所有期望值为 2026-10-17 scratch 实测输出。
- 类型一致性：TableCommand 签名在 Task 1/2 一致（ctx 首参）；testid 命名 Task 2/3 一致。

## Execution Ledger

- **Task 1: complete** — commit 656c134 — review Approved（3 Minor 登记在案：fakeState 构造建议登记基础设施；R1 注释集中声明处；height<=1 冗余防御）。
- **Task 2: complete** — commit 8f40341 — review Approved（偏离：create-test-editor.ts:39 `.use(milkdownPlugins)` 数组传参，Milkdown use 无 rest 签名，行为等价）。
- **Task 3: fix round 1 后 complete** — commit 83198f5 — review Approved（3 Minor 登记在案：拖拽后 Ctrl+S 落盘规范化属计划要求需 R1 登记；deleteTableRow clamp 分支无用例；rowPosAt O(rows)）。
  - Ruling-1：空行序列化以登记值 `|    |    |` 为准，计划笔误修正。
  - Ruling-2：行列新增命令单事务移光标进新行/列（Typora 行为）；deleteRow 折叠光标到 col 0 的产品行为改为保持原列。
  - Ruling-3：gfm 未组合 columnResizingPlugin（运行时证实），EditorHost 显式注册。
  - Ruling-4：净编辑为零时 Ctrl+S 跳过写盘属铁律 1 预期行为，e2e 断言该保真性质。
  - Parked finding：编辑后 ~500ms 内 Ctrl+S 可能误报「无改动」（listener 200ms debounce + sync 300ms 未收敛，EditorHost.tsx:116 flushNow 不覆盖 listener debounce）——非本计划范围，移交后续。
- **Task 4: complete** — 文档登记（component-api.md 3.11/3.12、TODO.md M2 P1、development.md R1）+ 全量门禁 + 本 Ledger；commit 见 git log。
