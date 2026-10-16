import { $prose, $remark } from '@milkdown/kit/utils'
import type { Root } from '@milkdown/kit/transformer'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'

/**
 * GFM 脚注支持：
 * - 解析层：remark-gfm 只把「有定义」的 `[^label]` 解析为 footnoteReference，
 *   未定义引用会留在 text 节点里并在序列化时被转义。这里在解析后把 text 中
 *   残留的 `[^label]` 补转换为 footnoteReference，保证未定义引用可往返。
 * - 语义统一（评审修正）：解析与键入对 `[^label]` 一律按引用处理；
 *   「行首 `[^label]:` 可能是正在键入的定义」仅由键入规则的
 *   atBlockStart/nextChar 条件识别，解析层不受前瞻影响（段落中部的
 *   `Text[^1]:` 在两层都解析为活引用 + 字面冒号）。
 * - 转义保真（评审补充）：mdast text 节点的 position 起点已越过反斜杠，
 *   无法用「源 != 值」检测转义；改为把源切片做去转义对齐（deescaped === value），
 *   并记录被转义的字符位——字面 `\[^1]` 保持转义，与活引用同段也可精确区分。
 *   仅当源切片无法对齐（如实体解码混排）时整段保守跳过转换。
 * - 编辑层：WYSIWYG 键入 `[^label]` 自动转换为引用节点；文档顶层段落形如
 *   `[^label]: 内容` 自动转换为脚注定义块，避免被序列化转义。
 */

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  identifier?: string
  label?: string
  position?: {
    start?: { offset?: number }
    end?: { offset?: number }
  }
}

const FOOTNOTE_REF_PATTERN = /\[\^([^\]\s]+)\]/g
const DEFINITION_PATTERN = /^\[\^([^\]\s]+)\]: (.*)$/s
const ASCII_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/

/** 把 text 值按 `[^label]` 拆分；源切片可对齐时精确识别转义并保留字面方括号。 */
function splitFootnoteRefs(text: string, sourceSlice: string): MdNode[] {
  const escapedAt = new Set<number>()
  let deescaped = ''
  let valueIndex = 0
  for (let si = 0; si < sourceSlice.length; si++) {
    const ch = sourceSlice[si]
    if (ch === '\\' && si + 1 < sourceSlice.length && ASCII_PUNCTUATION.test(sourceSlice[si + 1])) {
      escapedAt.add(valueIndex)
      deescaped += sourceSlice[si + 1]
      valueIndex++
      si++
      continue
    }
    deescaped += ch
    valueIndex++
  }
  // 对齐失败（实体解码等场景）：无法定位转义位，保守整段跳过转换
  if (deescaped !== text) return [{ type: 'text', value: text }]
  const nodes: MdNode[] = []
  let last = 0
  for (const match of text.matchAll(FOOTNOTE_REF_PATTERN)) {
    const label = match[1]
    const start = match.index
    if (label === undefined) continue
    if (escapedAt.has(start)) continue
    if (start > last) nodes.push({ type: 'text', value: text.slice(last, start) })
    nodes.push({ type: 'footnoteReference', identifier: label, label })
    last = start + match[0].length
  }
  if (last < text.length) nodes.push({ type: 'text', value: text.slice(last) })
  return nodes
}

function walkFootnoteRefs(node: MdNode, source: string): void {
  if (!node.children) return
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && typeof child.value === 'string') {
      const pos = child.position
      const start = pos?.start?.offset
      const end = pos?.end?.offset
      const slice =
        start !== undefined && end !== undefined && start >= 0 && end <= source.length
          ? source.slice(start, end)
          : ''
      return splitFootnoteRefs(child.value, slice)
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
