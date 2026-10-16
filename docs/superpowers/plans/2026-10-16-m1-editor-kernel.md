# md-editor M1（编辑内核）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 M1 编辑内核——round-trip 差异用例集（≥50 + 3 篇长文档）、输入规则实测补齐、GFM 全面可用、会话级撤销持久化、粘贴处理（HTML/URL/图片）、IME 手测收口，最终打标 `m1-editor-kernel`。

**Architecture:** 唯一编辑内核是 Milkdown 7（内部 ProseMirror + remark），挂在 `packages/editor`。Buffer 仍是唯一事实源（`packages/app/src/document/MdDocument`），`sync.ts` 的 300ms 防抖收敛不得破坏。round-trip 测试通过一个 editor 级 harness 直接驱动 `Editor.make().create()`：优先 Vitest + jsdom，不可行则回退 Playwright `window.__md_debug` 钩子。图片粘贴等一切 IO 走 `asset:save` 新 IPC（preload 白名单 + 主进程 handler + component-api.md 7 节三处同步）。

**Tech Stack:** Milkdown 7.22.3（@milkdown/kit）+ ProseMirror（Milkdown 内部依赖）+ React 18 + Vitest 5 + Playwright 1.64（`_electron`）+ Electron 44。**不新增任何 Markdown 解析器/编辑器内核**（铁律 3）。

**Spec:** `AGENTS.md`（三条铁律/高危区）· `architecture.md`（3.1/3.2/ADR-2/ADR-5/5 节）· `component-api.md`（2.2/3/7 节）· `development.md`（5 节新增节点流程 / 6 节 R1 R2 / 7 节）· `TODO.md` M1 段 · `DESIGN.md`

## Global Constraints

- 往返保真最高优先级：编辑后的序列化差异逐条登记进 `packages/editor/src/roundtrip.test.ts`，禁止静默规范化（development.md 6 R1）。
- Buffer 唯一事实源；渲染模式键入经 300ms 防抖收敛回 Buffer；`packages/editor/src/sync.ts` 现有实现与测试不得破坏。
- 零编辑保存 = 完全不写盘；`MdDocument.bytesForSave(): string | null` 语义保持。
- 渲染进程不得直接访问 Node/fs；新增能力必须同时改 `electron/preload` 白名单 + 主进程 handler + `component-api.md` 7 节 IPC 表；安全基线（contextIsolation true / nodeIntegration false / sandbox true）不可放宽。
- 依赖方向 `app → editor / export / theming`；`editor` 不得依赖 `app`。
- TypeScript strict、禁止 `any`；提交信息英文祈使句 + scope。
- M0 e2e 7 例始终全绿；新增 e2e 只能加不能删。
- 平台 Windows + PowerShell；零安装约束：不装 Rust/MSVC/WSL/Docker 及系统级工具。
- 环境：Node 24 / pnpm 11 / git；`pnpm build:app` 后 e2e 用真实 Electron 跑。

## 基线记录（动第一行代码前）

- `git log --oneline -5`：fba22b5 chore(repo): remove stale m0 plan docs and extend gitignore（HEAD，tag m0-electron）。
- `git status`：仅未跟踪 `docs/superpowers/prompts/`，无未提交代码。
- `pnpm test`：Test Files 6 passed (6)，Tests 32 passed (32)。
- `pnpm e2e`：7 passed (6.1s)（open-save 3 / external-change 2 / print-pdf 1 / shell 1）。

---

### Task 0: round-trip harness spike（jsdom 可行性）

**Files:**

- Create: `packages/editor/src/roundtrip.test.ts`（先只放 harness + 5 个冒烟用例）
- Create: `packages/editor/src/testing/create-test-editor.ts`（harness，Task 1 起被用例复用）
- Create: `packages/editor/src/__fixtures__/harness-smoke.md`（Task 1 起被用例复用）

**Interfaces:**

- Consumes: `@milkdown/kit/core` 的 `Editor`、`defaultValueCtx`、`rootCtx`；`@milkdown/kit/preset/commonmark`、`gfm`；`@milkdown/kit/utils` 的 `getMarkdown`。
- Produces: `createTestEditor(markdown: string): Promise<{ getMarkdown(): string; destroy(): void }>`——Task 1/2 的所有 round-trip 用例只经由它驱动编辑器；`roundtrip.test.ts` 的用例形如 `roundtrip(input, expectedOrIdentity)`。

- [x] **Step 1: 写 harness 冒烟测试（预期先失败/或发现 jsdom 不可行）**

`packages/editor/src/testing/create-test-editor.ts`（jsdom 版实现）：

```ts
import { defaultValueCtx, Editor, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { getMarkdown } from '@milkdown/kit/utils'

export interface TestEditor {
  getMarkdown(): string
  destroy(): Promise<void>
}

/** jsdom 环境下创建一个无 React 的 Milkdown Editor，用于 round-trip 测试。 */
export async function createTestEditor(markdown: string): Promise<TestEditor> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, markdown)
    })
    .use(commonmark)
    .use(gfm)
  await editor.create()
  return {
    getMarkdown: () => editor.action(getMarkdown()),
    destroy: async () => {
      await editor.destroy()
      root.remove()
    },
  }
}
```

`packages/editor/src/roundtrip.test.ts` 初始 5 个冒烟用例：

````ts
import { describe, expect, it } from 'vitest'
import { createTestEditor } from './testing/create-test-editor'

async function roundtrip(input: string): Promise<string> {
  const editor = await createTestEditor(input)
  try {
    return editor.getMarkdown()
  } finally {
    await editor.destroy()
  }
}

describe('round-trip harness smoke', () => {
  it('preserves a heading', async () => {
    expect(await roundtrip('# Hello\n')).toBe('# Hello\n')
  })
  it('preserves a bullet list', async () => {
    expect(await roundtrip('- a\n- b\n')).toBe('- a\n- b\n')
  })
  it('preserves a blockquote', async () => {
    expect(await roundtrip('> quote\n')).toBe('> quote\n')
  })
  it('preserves a fenced code block with language', async () => {
    expect(await roundtrip('```ts\nconst a = 1\n```\n')).toBe('```ts\nconst a = 1\n```\n')
  })
  it('preserves a gfm table', async () => {
    expect(await roundtrip('| a | b |\n| --- | --- |\n| 1 | 2 |\n')).toBe(
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
    )
  })
})
````

- [x] **Step 2: 确认 jsdom 是否可行**

运行 `pnpm vitest run packages/editor/src/roundtrip.test.ts --environment jsdom`（若仓库无 jsdom 依赖，先 `pnpm add -Dw jsdom`——这是测试环境依赖，不是 Markdown 内核，不违反铁律 3；记录进「已知偏离与登记」）。

- 若 5 用例全绿：harness 定案为 jsdom，继续 Task 1。
- 若 jsdom 失败（Editor.create 抛错/需要真实布局）：删除 jsdom 版 harness，改走 Playwright 方案——在 `packages/editor` 增加开发专用 `window.__md_debug`（`packages/editor/src/dev-hook.ts`，仅 `import.meta.env.DEV` 下暴露 `{ getMarkdown, setMarkdown }`，经 `e2e` 驱动），在 `component-api.md` 3.1 登记。harness 用例改写为 Playwright spec `e2e/roundtrip.spec.ts`（批量用例循环执行，打开一页编辑器 → 喂入 markdown → 读出序列化）。无论哪条路，最终 harness 方案写进 `development.md` 5 节（新增小节「round-trip harness」）。

- [x] **Step 3: 让 harness 稳定**

连续跑 3 遍用例命令确认无 flake（全绿 ×3）。

- [x] **Step 4: 提交**

```powershell
git add packages/editor/src/roundtrip.test.ts packages/editor/src/testing/ packages/editor/package.json package.json pnpm-lock.yaml
git commit -m "test(editor): add jsdom round-trip harness with smoke cases"
```

### Task 1: round-trip 差异登记用例集（≥50 用例）

**Files:**

- Modify: `packages/editor/src/roundtrip.test.ts`（扩到 ≥50 用例）
- Create: `packages/editor/src/__fixtures__/long-doc-1.md`、`long-doc-2.md`、`long-doc-3.md`
- Modify: `development.md` 5 节（登记 harness 方案与差异登记约定）

**Interfaces:**

- Consumes: Task 0 的 `createTestEditor`。
- Produces: `roundtrip.test.ts` 内按类目分组的 describe 块（headings / lists / blockquote / code / table / tasklist / emphasis / links-images / hr / mixed-nesting / long-docs），长文档用例读 `__fixtures__` 并断言 `roundtrip(text) === text` 或登记的规范化结果。

- [x] **Step 1: 写失败测试**

在 `roundtrip.test.ts` 按类目补齐到 ≥50 用例，必须覆盖且每条显式写出预期序列化（含规范化差异登记）：

1. headings：`#`~`######`、`Setext`（`===`/`---`，登记规范化为 ATX）、含尾随 `#`、标题内强调。
2. lists：`-`、`*`、`+` 混用（登记统一为 `-`）、嵌套缩进 2/4 空格、有序列表 `1.` 与起始序号 `3.`、有序列表嵌套、松/紧列表空行（登记：紧列表序列化）。
3. blockquote：单层、多层 `> >`、含列表的引用、引用内代码块。
4. code：`围栏带语言、无语言、~~~ 围栏（登记：统一为` ）、缩进代码块（登记：转 fenced）、围栏内特殊字符（`|`、`#`）。
5. table：管道表、对齐 `:---:`/`---:`（登记：对齐标记保留形态，按 Milkdown 实际输出登记）、单元格内管道转义、空单元格、只有表头。
6. tasklist：`- [ ]` / `- [x]`、嵌套任务、任务内强调。
7. emphasis：`*a*`/`_a_`（登记统一输出）、`**`/`__`、`~~del~~`、`*斜体*` 中文边界（`中文*强调*中文`）、嵌套 `**_x_**`。
8. links/images：行内链接 `[t](u)`、标题链接、autolink `<https://example.com>`（登记输出形态）、图片 `![alt](src)`、含空格 URL（尖括号形式）、链接内加粗。
9. hr：`---`/`***`（登记统一输出）、前后空行。
10. mixed-nesting：引用内表格、列表内代码块、表格单元格内换行 `<br>`（登记输出形态）、连续段落间 1/2 个空行（登记统一为 1 空行）、多语言文档（中文/emoji/CJK 标点）。
11. long-docs：3 篇 fixture（`__fixtures__/`）——第 1 篇取本仓库 `AGENTS.md` 内容裁剪版（标题/列表/表格/代码混排）、第 2 篇手写 ≥300 行含大表格（≥30 行）与长列表混合、第 3 篇中文长文档（段落+嵌套列表+引用+代码块）。断言整篇 round-trip 等值；不等值处登记为该文档的已知差异用例（不得直接改成 `!==` 蒙混）。

- [x] **Step 2: 运行确认失败/收集实际输出**

`pnpm vitest run packages/editor/src/roundtrip.test.ts`
预期：部分用例 FAIL——把每个差异处的**实际输出**逐条回填为登记的期望值（或写成 `expect(actual).toBe(登记值)` 注释说明差异），不许为了让绿而改成宽松断言。

- [x] **Step 3: 跑绿 + 稳定性**

`pnpm test`（全部单元测试），连续 3 遍 roundtrip 测试全绿。

- [x] **Step 4: 更新 development.md**

5 节新增「round-trip harness」小节：写明采用 jsdom 还是 Playwright、`createTestEditor` 用法、差异登记规则（未登记差异视为回归）。

- [x] **Step 5: 提交**

```powershell
git add packages/editor/src/roundtrip.test.ts packages/editor/src/__fixtures__/ development.md
git commit -m "test(editor): register 50+ round-trip difference cases with fixtures"
```

### Task 2: 输入规则实测与补齐（# / > / - / 1. / 围栏 / 表格管道 / 任务列表）

**Files:**

- Create: `e2e/input-rules.spec.ts`
- Modify: `packages/editor/src/index.ts` 与/或新增 `packages/editor/src/input-rules.ts`（仅当实测缺失才补自定义规则）
- Modify: `component-api.md` 3 节（如新增导出）

**Interfaces:**

- Consumes: 现有 `EditorHost`（`packages/editor/src/EditorHost.tsx`）与 e2e 现有打开 fixture 模式（`--open` CLI + `.ProseMirror` 选择器）。
- Produces: e2e 输入规则矩阵全绿；如缺失则 `packages/editor` 导出 `editorInputRules`（`Milkdown` 插件数组，在 `EditorHost.tsx` 的 `.use(...)` 中追加）。

- [x] **Step 1: 写失败/探测测试**

`e2e/input-rules.spec.ts`：对每条规则用 `page.keyboard.type` 键入触发序列，然后 `Ctrl+S` 落盘读文件断言：

| 用例       | 键入                            | 期望落盘                                       |
| ---------- | ------------------------------- | ---------------------------------------------- |
| heading    | `# 标题` + Enter 后 `内容`      | `# 标题\n\n内容\n`（以实际 Milkdown 输出登记） |
| blockquote | `> 引用`                        | `> 引用\n`                                     |
| bullet     | `- 项目`                        | `- 项目\n`                                     |
| ordered    | `1. 第一`                       | `1. 第一\n`                                    |
| fence      | ` ```ts ` + Enter + `const a=1` | ` ```ts\nconst a=1\n``` `                      |
| table pipe | `                               | a                                              | b   | ` + Enter | Milkdown 表格序列化结果（登记） |
| tasklist   | `- [ ] 待办`                    | `- [ ] 待办\n`                                 |
| escape     | 输入 `1\. 不是列表`（转义点）   | 保持原样不被解析为列表                         |

复用 e2e 现有 helper（`e2e/open-save.spec.ts` 的启动与保存写法），fixture 用临时文件目录。

- [x] **Step 2: 运行确认失败项**

`pnpm e2e -- e2e/input-rules.spec.ts`
预期：Milkdown commonmark/gfm 自带规则大概率全绿；FAIL 项即为缺失规则。

- [x] **Step 3: 最小实现缺失规则**

仅对 FAIL 项在 `packages/editor/src/input-rules.ts` 写自定义 input rule（`@milkdown/kit/prose` 的 `InputRule`，注册进 Milkdown 插件并在 `EditorHost.tsx` 追加 `.use(editorInputRules)`）；每条缺失规则配 e2e 用例。若全绿则本步记「无需自定义规则」并只提交 e2e 矩阵。

- [x] **Step 4: 全量回归**

`pnpm e2e`（7 例 M0 + 新增 input-rules 全绿）+ `pnpm test`。

- [x] **Step 5: 提交**

```powershell
git add e2e/input-rules.spec.ts packages/editor/src/ packages/editor/index.ts component-api.md
git commit -m "feat(editor): verify and register markdown input rules"
```

### Task 3: 会话级撤销栈持久化（P1）

**Files:**

- Create: `packages/editor/src/session-history.ts`
- Modify: `packages/editor/src/EditorHost.tsx`
- Test: `packages/editor/src/session-history.test.ts` + `e2e/undo-session.spec.ts`

**Interfaces:**

- Consumes: `@milkdown/kit/plugin/history` 的 `historyKeyCtx`（若不可从 kit 导出，改用 `prosemirror-history` 的 `history` plugin key——Milkdown 已内含该依赖，只复用不新增解析器）。
- Produces: `sessionHistory` 模块：`saveHistory(docId: string, state: unknown): void` / `loadHistory(docId: string): unknown | null` / `clearHistory(docId: string): void`（内存 Map，随进程存活）；`EditorHost` 在卸载时保存、创建时恢复（同一 docId 的标签页关闭重开或外部重载后撤销栈仍在）。

- [x] **Step 1: 写失败测试**

`session-history.test.ts`（jsdom）：创建 `createTestEditor` 后用 `editor.action((ctx) => ctx.get(editorViewCtx))` 拿 view，dispatch 两次插入事务 → `saveHistory('doc1', view.state)` → 新建同 markdown 编辑器并 `loadHistory` → 断言 `undo(view.state)` 可撤销且撤销后文档回到初始文本。`e2e/undo-session.spec.ts`：键入文字 → 关闭标签页（e2e 场景简化为重新挂载：`page.reload()` 场景属 M3 多标签，这里用 e2e 断言撤销栈在 EditorHost 重挂后仍可 Ctrl+Z 回退到打开时内容）。

- [x] **Step 2: 确认失败 → 最小实现**

`session-history.ts`：`const store = new Map<string, unknown>()`；`EditorHost.tsx` 卸载 effect 里从 `editorViewCtx` 保存 state，创建后若 `loadHistory` 命中则用 `EditorState.fromJSON(state.schema, json)` 思路恢复（Milkdown 场景：把保存的 `HistoryState` 通过 history plugin key set 回新 state；若 Milkdown 不支持直接注入，则登记偏离并在 e2e 用「重挂后仍可 undo」的行为断言兜底——不许为绕开而改断言语义）。

- [x] **Step 3: 跑绿 + 全量回归**

`pnpm test` + `pnpm e2e`。

- [x] **Step 4: 提交**

```powershell
git add packages/editor/src/ e2e/undo-session.spec.ts
git commit -m "feat(editor): keep undo stack across editor remounts in session"
```

### Task 4: 粘贴处理（HTML → Markdown、URL → 链接、图片粘贴存盘）

**Files:**

- Create: `packages/editor/src/paste.ts`
- Modify: `packages/editor/src/EditorHost.tsx`
- Modify: `electron/preload/index.ts` + `electron/shared/channels.ts` + 主进程 handler（`electron/main/` 对应文件）
- Modify: `component-api.md` 2.1 / 7 节、`development.md`（如涉及约定）
- Test: `packages/editor/src/paste.test.ts` + `e2e/paste.spec.ts`

**Interfaces:**

- Consumes: 现有 `MdEditorBridge` 契约（component-api.md 2.1）；Milkdown/prosemirror-view 的 `transformPasted`、`handlePaste`（prosemirror-view 已随 Milkdown 依赖存在，不新增包）。
- Produces:
  - `htmlToMarkdown(html: string): string`——用 Milkdown 的 DOMParser（`@milkdown/kit/core` 的 `parserCtx` 或 `editorViewCtx.state.schema` + `DOMParser.parse`）把 HTML 片段解析为 PM Doc 再 `getMarkdown`，**不引入 turndown 之类的第二套转换器**。
  - `EditorHost` props 新增 `onPasteAsset?: (base64: string, mime: string) => Promise<string>`；app 侧实现为调 `window.mdEditor.saveAsset(path, base64, ext)` 返回相对路径。
  - preload 新增 `saveAsset(docPath: string, bytesBase64: string, ext: string): Promise<string>`（通道 `asset:save`），主进程写 `<docDir>/assets/<yyyy-MM-dd-HHmmss>-<rand>.<ext>` 并返回 `assets/xxx.png` 相对路径；ext 白名单 `png|jpg|jpeg|gif|webp`；docPath 为 null（未保存文档）时返回错误（v1 行为：提示先保存文档）。

- [ ] **Step 1: 写失败测试**

`paste.test.ts`（jsdom）：`htmlToMarkdown('<h1>标题</h1><p><strong>加粗</strong> 与 <a href="https://e.com">链接</a></p><ul><li>项</li></ul>')` 断言 `# 标题\n\n**加粗** 与 [链接](https://e.com)\n\n- 项\n` 形态（按实际输出登记）；URL 粘贴断言选中文字变 `[文字](url)`（transformPasted 单元测试）。`e2e/paste.spec.ts`：`DataTransfer` 注入 `text/html` 剪贴板 → 断言序列化结果；图片粘贴用 `ClipboardEvent` 注入 png File → mock 主进程返回相对路径 → 断言文档出现 `![](assets/xxx.png)` 且磁盘出现文件。

- [ ] **Step 2: 确认失败 → 实现**

`paste.ts` 实现 `htmlToMarkdown` + Milkdown 插件（`prosemirror-view` EditorProps：`transformPasted`/`handlePaste`，注册进 `EditorHost`）；preload/main/`channels.ts` 同步加 `asset:save`（handler 用现有 `fs_io.writeAtomic` 写入，路径 join + 扩展名校验）。

- [ ] **Step 3: 跑绿 + 全量回归 + 安全断言**

`pnpm test`、`pnpm e2e`（M0 7 例 + 新增全绿）；确认 `e2e/shell.spec.ts` 的无 Node 断言仍绿。

- [ ] **Step 4: 文档同步**

`component-api.md` 2.1 加 `saveAsset`、7 节 IPC 表加 `asset:save` 行。

- [ ] **Step 5: 提交**

```powershell
git add packages/editor/ packages/app/ electron/ component-api.md e2e/paste.spec.ts
git commit -m "feat(editor): paste html as markdown, urls as links, images to assets"
```

### Task 5: 中文 IME 专项手测（Windows 11 + 微软拼音）——人工协作点

**Files:**

- Modify: `development.md` 6 节 R2（记录结果）
- Modify: `TODO.md`（如有缺陷新增条目）

**做法（必须真实手测，不许跳过）：**

- [x] **Step 1:** 启动 `pnpm dev`，用户/执行者用微软拼音在：标题行、列表项、表格单元格、代码块内 连打拼音 → 选字 → Ctrl+Z 撤销。
- [x] **Step 2:** 验证 IME 组合窗口中键入 `#`、`-`、`1.` 不触发输入规则（确认 composition 事件被 prosemirror 正确挂起）。
- [x] **Step 3:** 结果记录进 development.md R2（勾选 + 日期「2026-10-16」+ 环境「Windows 11 + 微软拼音」）；失败项在 TODO.md M1 加缺陷条目并**立即停下来报告用户**。
- [x] **Step 4:** 提交 `docs(development): record M1 IME manual test results`。

### Task 6: 脚注（P2 决策点 + 实现/延期登记）

- [x] **Step 1:** 评估结论：Milkdown gfm preset（7.22.3）已内置 footnoteReference/footnoteDefinition schema 与 remark-gfm 解析；用户已裁定实现。gfm 未覆盖「未定义引用」与 WYSIWYG 键入，由 packages/editor/src/footnotes.ts 补齐（remark 解析补丁 + $prose 键入规则，未引入第二套解析器）。
- [x] **Step 2（实现路径时）:** 按 development.md 5 节流程：注册 footnote 节点（gfm 内置 + footnotes.ts 补丁）→ roundtrip.test.ts 加 6 例（基本/多引用/未定义/嵌套/文字标签/多段定义）→ e2e/footnote.spec.ts 2 例（键入 + 解析渲染）→ 提交 `feat(editor): support gfm footnotes`。
- [ ] **Step 2（延期路径时）:** TODO.md M1 脚注条目标注延期 + v1 发布说明登记占位（`docs/` 或 README release notes 节），提交 `docs: defer footnotes to v1.1 with release note`。

### Task 7: 收尾——全量验收 + 文档对齐 + 打标

**Files:**

- Modify: `TODO.md`（M1 勾选 + 验收记录）
- Modify: `development.md`（R1/R2 更新、7 节如有新性能数据）
- Modify: `component-api.md`、`DESIGN.md`（新视觉仅当有，如任务列表 checkbox 样式）
- 修改: 计划文末「已知偏离与登记」表

- [ ] **Step 1:** 全量命令逐一跑绿并记录输出摘要：`pnpm typecheck` → `pnpm lint` → `pnpm test` → `pnpm e2e` → `pnpm build:app`。
- [ ] **Step 2:** TODO.md M1 每条勾选 + 验收记录（round-trip 用例数 ≥50、长文档 3 篇、IME 手测结论、各命令输出摘要）。
- [ ] **Step 3:** component-api.md 与最终实现对齐核对（3 节导出、7 节 IPC 表）；DESIGN.md 如有新视觉 token 登记。
- [ ] **Step 4:** 提交全部文档 `docs: close out m1 editor kernel milestone`。
- [ ] **Step 5:** `git tag m1-editor-kernel` 并向用户交总结（完成情况、逐条验收、偏离清单、未验证项）。

---

## 已知偏离与登记

| #      | 偏离                                                                                                                                                                      | 说明                                                                                                     | 日期       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------- |
| （空） |                                                                                                                                                                           |                                                                                                          |            |
| 1      | 新增 devDependency jsdom ^30.1.2（Task 0）                                                                                                                                | 测试环境依赖，非 Markdown 内核，不违反铁律 3                                                             | 2026-10-16 |
| 2      | 冒烟用例 2 例期望值按 Milkdown 实际序列化登记（bullet `-`→`*`、表格分隔行最小化）                                                                                         | 铁律 1 差异登记要求，已注释登记                                                                          | 2026-10-16 |
| 3      | round-trip 用例实现为 `roundtrip(input)` + 内联 `toBe(expected)`（计划原写 `roundtrip(input, expectedOrIdentity)`）                                                       | 语义等价，精确断言不变                                                                                   | 2026-10-16 |
| 4      | fixtures 加入 .prettierignore                                                                                                                                             | 保护测试数据字节级原样（expected 快照含列宽 padding）                                                    | 2026-10-16 |
| 5      | 表格管道 Enter 规则 Milkdown/gfm 未覆盖，补自定义 keymap 规则（editorInputRules）                                                                                         | 仅复用 gfm 已注册 table 节点，未引入第二套解析器                                                         | 2026-10-16 |
| 6      | Milkdown history key 不导出、HistoryState 不可序列化，会话撤销改用 step JSON 重放重建撤销栈                                                                               | 撤销/重做语义未减弱（e2e + 单测兜底）；显式依赖 @milkdown/prose@7.22.3 与 kit 同源                       | 2026-10-16 |
| 7      | 重放/恢复期间抑制 recorder 记录，恢复后重置 recorder 状态                                                                                                                 | 修复评审发现的基线污染缺陷，非计划内但属正确性修复                                                       | 2026-10-16 |
| 8      | IME 验证改为 CDP Input.imeSetComposition 自动化模拟（用户授权免真人实测），e2e/ime.spec.ts 6 例；真人微软拼音候选窗/确认键/组合内撤销标记待补                             | 保真度边界已在 development.md R2 如实登记                                                                | 2026-10-16 |
| 9      | IME 提交信息为 test(e2e)/fix(e2e)（计划写 docs(development)）                                                                                                             | 实际产出含 e2e 用例与断言修复，不只是文档                                                                | 2026-10-16 |
| 10     | Task 6 评估结论：Milkdown gfm preset 已内置 footnote schema；补 packages/editor/src/footnotes.ts（remark 未定义引用补丁 + $prose 键入规则）                               | 未引入第二套解析器，复用 gfm 注册的 footnote_reference/footnote_definition 节点                          | 2026-10-16 |
| 11     | 脚注新增 e2e/footnote.spec.ts 2 例（键入往返 + 解析渲染），component-api.md 新增 3.6 节；未新增 DESIGN.md token（沿用 sup/dl 默认语义，无新视觉变量）                     | Task 6 计划只写「e2e 键入验证」，解析渲染用例为补充回归                                                  | 2026-10-16 |
| 12     | 评审修正：移除 `[^label]` 解析前瞻，解析/键入统一按活引用处理（`Text[^1]:` 两层对称）；转义检测改为源切片去转义对齐；混合场景「转义+活引用同段尾随空格」按实际输出登记 R1 | roundtrip.test.ts 新增 3 例（转义/混合/引用后冒号）；Milkdown text 序列化 fast path 丢转义为已知登记差异 | 2026-10-16 |

## 执行顺序

Task 0 → 1 → 2 → 3 → 4 → 5（需人工手测协作）→ 6 → 7。Task 5 IME 手测需要真人参与微软拼音输入；若由执行者自测则用本机输入法完成并如实记录。每个 Task 结束：勾选计划 checkbox、跑 M0 e2e 7 例确认全绿、给用户简报。
