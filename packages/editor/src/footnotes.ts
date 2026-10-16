import { $prose, $remark } from '@milkdown/kit/utils'
import type { Root } from '@milkdown/kit/transformer'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'

/**
 * GFM 脚注支持：
 * - 解析层：remark-gfm 只把「有定义」的 `[^label]` 解析为 footnoteReference，
 *   未定义引用会留在 text 节点里并在序列化时被转义。这里在解析后把 text 中
 *   残留的 `[^label]` 补转换为 footnoteReference，保证未定义引用可往返。
 * - 编辑层：WYSIWYG 键入 `[^label]` 自动转换为引用节点；文档顶层段落形如
 *   `[^label]: 内容` 自动转换为脚注定义块，避免被序列化转义。
 *
 * 已知局限（R1 登记）：`\[^1]`（转义的字面方括号）在 remark 解析后无法与
 * 未定义引用区分；解析时通过「源文本 != 文本值」检测转义并整段跳过转换，
 * 但键入侧的未转换文本仍可能被序列化转义（见 component-api.md 已知局限）。
 */

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  identifier?: string
  label?: string
}

const FOOTNOTE_REF_PATTERN = /\[\^([^\]\s]+)\](?!:)/g
const DEFINITION_PATTERN = /^\[\^([^\]\s]+)\]: (.*)$/s

/** 把 text 值按 `[^label]` 拆分；检测到源文本含转义时整段跳过。 */
function splitFootnoteRefs(text: string, hadEscape: boolean): MdNode[] {
  if (hadEscape) return [{ type: 'text', value: text }]
  const nodes: MdNode[] = []
  let last = 0
  for (const match of text.matchAll(FOOTNOTE_REF_PATTERN)) {
    const label = match[1]
    const start = match.index
    if (label === undefined) continue
    if (start > last) nodes.push({ type: 'text', value: text.slice(last, start) })
    nodes.push({ type: 'footnoteReference', identifier: label, label })
    last = start + match[0].length
  }
  if (last < text.length) nodes.push({ type: 'text', value: text.slice(last) })
  return nodes
}

function hasSourceEscape(node: MdNode, source: string): boolean {
  const withPos = node as { start?: { offset?: number }; end?: { offset?: number } }
  const start = withPos.start?.offset
  const end = withPos.end?.offset
  if (start === undefined || end === undefined || start < 0 || end > source.length) return false
  return source.slice(start, end) !== node.value
}

function walkFootnoteRefs(node: MdNode, source: string): void {
  if (!node.children) return
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && typeof child.value === 'string') {
      return splitFootnoteRefs(child.value, hasSourceEscape(child, source))
    }
    walkFootnoteRefs(child, source)
    return [child]
  })
}

/** 解析后把未定义脚注引用补转换为 footnoteReference 节点。 */
function footnoteRefRemarkTransformer(tree: Root, file?: unknown): void {
  const source = typeof file === 'object' && file !== null ? String(file) : ''
  walkFootnoteRefs(tree as unknown as MdNode, source)
}

/** Milkdown remark 插件：解析管道中在 remark-gfm 之后运行。 */
export const footnoteUndefinedRefPlugin = $remark(
  'md-footnote-undefined-ref',
  () => () => footnoteRefRemarkTransformer,
)

interface InlineRefOp {
  from: number
  to: number
  label: string
}

interface DefOp {
  from: number
  to: number
  label: string
  content: Fragment
}

interface ReplaceOp {
  from: number
  to: number
  node: ProseNode
}

/** 取段落内联内容第 `fromChar` 个字符之后的 Fragment（保留 marks）。 */
function inlineFragmentAfter(node: ProseNode, fromChar: number): Fragment {
  const pieces: ProseNode[] = []
  let acc = 0
  node.forEach((child) => {
    const size = child.isText ? (child.text?.length ?? 0) : child.nodeSize
    const end = acc + size
    if (acc >= fromChar) {
      pieces.push(child)
    } else if (end > fromChar) {
      pieces.push(child.isText ? child.cut(fromChar - acc) : child)
    }
    acc = end
  })
  return Fragment.fromArray(pieces)
}

function collectRefOps(state: EditorState, from: number, to: number): InlineRefOp[] {
  const ops: InlineRefOp[] = []
  const scanFrom = Math.max(0, from - 2)
  const scanTo = Math.min(state.doc.content.size, to + 2)
  state.doc.nodesBetween(scanFrom, scanTo, (node, pos) => {
    if (!node.isText || !node.text) return true
    if (node.marks.some((mark) => mark.type.name === 'inlineCode')) return true
    for (const match of node.text.matchAll(FOOTNOTE_REF_PATTERN)) {
      const label = match[1]
      if (label === undefined) continue
      const index = match.index
      const start = pos + index
      const preceding = index > 0 ? node.text[index - 1] : ''
      if (preceding === '\\') continue
      const atBlockStart = state.doc.resolve(start).parentOffset === 0
      const nextChar =
        index + match[0].length < node.text.length ? node.text[index + match[0].length] : ''
      // 行首的 `[^label]` 可能正在键入定义（后随 `:` 或尚未输入），先不转换；
      // 行内引用立即转换，避免序列化时被转义。
      if (!atBlockStart || (nextChar !== '' && nextChar !== ':')) {
        ops.push({ from: start, to: start + match[0].length, label })
      }
    }
    return true
  })
  return ops
}

function collectDefOps(doc: ProseNode, from: number, to: number): DefOp[] {
  const ops: DefOp[] = []
  doc.forEach((node, offset) => {
    if (node.type.name !== 'paragraph') return
    const nodeEnd = offset + node.nodeSize
    if (offset >= to || nodeEnd <= from) return
    const text = node.textContent
    const match = DEFINITION_PATTERN.exec(text)
    if (!match) return
    const label = match[1]
    if (label === undefined) return
    const trailing = match[2] ?? ''
    let contentStart = text.length - trailing.length
    if (trailing.startsWith(' ')) contentStart++
    ops.push({ from: offset, to: nodeEnd, label, content: inlineFragmentAfter(node, contentStart) })
  })
  return ops
}

/**
 * WYSIWYG 键入/粘贴规则：
 * - 段落内出现完整 `[^label]` → footnote_reference 节点；
 * - 文档顶层段落形如 `[^label]: 内容` → footnote_definition 块。
 */
export const footnoteInputRules = $prose(() => {
  return new Plugin({
    key: new PluginKey('MD_FOOTNOTE_INPUT_RULES'),
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null
      const ranges: Array<{ from: number; to: number }> = []
      for (const tr of transactions) {
        if (!tr.docChanged) continue
        tr.mapping.maps.forEach((map) => {
          map.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
            ranges.push({ from: newFrom, to: newTo })
          })
        })
      }
      const refType = newState.schema.nodes.footnote_reference
      const defType = newState.schema.nodes.footnote_definition
      const paraType = newState.schema.nodes.paragraph
      if (!refType || !defType || !paraType) return null

      const ops: ReplaceOp[] = []
      for (const range of ranges) {
        for (const op of collectRefOps(newState, range.from, range.to)) {
          ops.push({ from: op.from, to: op.to, node: refType.create({ label: op.label }) })
        }
        for (const op of collectDefOps(newState.doc, range.from, range.to)) {
          ops.push({
            from: op.from,
            to: op.to,
            node: defType.create({ label: op.label }, paraType.create(null, op.content)),
          })
        }
      }
      if (ops.length === 0) return null
      ops.sort((a, b) => b.from - a.from)
      const tr: Transaction = newState.tr
      let appliedFrom = Number.POSITIVE_INFINITY
      for (const op of ops) {
        // 位置按旧文档快照计算：后应用的替换只会影响更大偏移一侧，
        // 与已应用区间重叠的 op（如定义块替换吞并的行内引用）必须跳过。
        if (op.to > appliedFrom) continue
        tr.replaceWith(op.from, op.to, op.node)
        appliedFrom = op.from
      }
      return tr
    },
  })
})
