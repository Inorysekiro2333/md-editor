/**
 * cursor-map：Markdown offset ↔ MdCursor（remark 层）与 PM pos ↔ Markdown offset
 * / MdCursor（PM bridge 层）互转（纯函数）。
 *
 * 语义约定（architecture.md 3.4 / M2 计划 Task 1 + Task 2 的验收定义）：
 * - 所有 offset 均为 Markdown 字符串中的 UTF-16 code unit 下标。
 * - `path[i]` = 第 i 层 mdast 节点在其父节点 children 中的下标；
 *   `mdOffsetToCursor` 的解析目标是「包含该 offset 的最深 mdast 节点」，
 *   `cursor.offset` 相对该节点 `position.start.offset`。
 * - 节点边界偏好：offset == child.end 时归入该 child（offset = child.end - child.start）。
 * - `mdOffsetToCursor` 的 offset 会被钳制到 [0, 根节点 end]；空文档（''）返回 `{ path: [], offset: 0 }`。
 * - `cursorToMdOffset` 永不 throw：path 沿途任一层失效（越界、目标节点不是容器）时，
 *   逐级回退到最近可解析祖先并把 offset 归零（块首 = 该祖先 `position.start.offset`，
 *   root 视为文档起点 0）——即 architecture.md 3.4 第 3 条退化规则；path 有效但 offset
 *   超出目标节点 end 时 clamp 到 end（登记用例见 cursor-map.test.ts）。
 * - PM bridge（Task 2）：PM Doc 与 mdast 同源于同一 Buffer，按「lockstep 平行游走」
 *   建立位置映射（已用真实 Milkdown parse 核实 PM↔mdast 结构对应关系）：
 *   块级逐 child 同步前进（paragraph/heading/blockquote/list/listItem/table/code 等）；
 *   行内按 text↔text、inlineCode↔code mark text、strong/emphasis/link/delete↔对应
 *   mark 的扁平 text 段、image/hardbreak/html↔同名叶子 配对。kind 不对应或长度不一致时
 *   走顶层块级 fallback（按块序映射到块首），accuracy='ancestor'，永不 throw。
 * - `markdownOffsetToPmPos`：offset 落在叶子文本区 → exact；否则取最近锚点
 *   （md 距离平局取后方），accuracy='ancestor'。`pmPosToMarkdownOffset` 为其反向投影。
 * - mdast 节点 position 可能缺省：缺省时 start/end 均按 0 处理。
 * - 纯函数：无 DOM、无 IO、无全局可变状态；模块级仅缓存一个 immutable parser 实例。
 *   解析管线与 Milkdown transformer 一致（remark-parse + remark-gfm），保证表格/
 *   删除线等 GFM 结构与 PM Doc 对应。
 */
import type { Node as PMNode } from '@milkdown/prose/model'
import type { Root, RootContent } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

/** mdast 节点路径 + 相对最深节点起点的偏移。 */
export interface MdCursor {
  path: number[]
  offset: number
}

/** 位置映射精度：exact = 双侧文本边界一一对应；ancestor = 近似（块首/最近文本边界）。 */
export type CursorAccuracy = 'exact' | 'ancestor'

export interface PositionResult {
  pos: number
  accuracy: CursorAccuracy
}

const parser = unified().use(remarkParse).use(remarkGfm)

type MdastNode = Root | RootContent

interface MdastParentLike {
  readonly children: readonly RootContent[]
}

function isParent(node: MdastNode): node is MdastNode & MdastParentLike {
  return 'children' in node && Array.isArray(node.children)
}

function startOffsetOf(node: MdastNode): number {
  return node.position?.start.offset ?? 0
}

function endOffsetOf(node: MdastNode): number {
  return node.position?.end.offset ?? 0
}

export function mdOffsetToCursor(markdown: string, offset: number): MdCursor {
  return cursorFromOffset(parser.parse(markdown), clampMd(markdown, offset))
}

export function cursorToMdOffset(markdown: string, cursor: MdCursor): number {
  return offsetFromCursor(parser.parse(markdown), cursor)
}

function clampMd(markdown: string, offset: number): number {
  return Math.min(Math.max(offset, 0), markdown.length)
}

function cursorFromOffset(root: Root, offset: number): MdCursor {
  const rootStart = startOffsetOf(root)
  const clamped = Math.min(Math.max(offset, rootStart), endOffsetOf(root))
  const path: number[] = []
  let node: MdastNode = root
  let nodeStart = rootStart
  while (isParent(node)) {
    const children: readonly RootContent[] = node.children
    let next = -1
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      const childStart = startOffsetOf(child)
      if (clamped >= childStart && clamped <= endOffsetOf(child)) {
        next = i
        break
      }
    }
    if (next === -1) break
    const child: RootContent = children[next]
    path.push(next)
    node = child
    nodeStart = startOffsetOf(child)
  }
  return { path, offset: clamped - nodeStart }
}

function offsetFromCursor(root: Root, cursor: MdCursor): number {
  let node: MdastNode = root
  let nodeStart = startOffsetOf(root)
  let degraded = false
  for (const index of cursor.path) {
    if (!isParent(node)) {
      degraded = true
      break
    }
    const child: RootContent | undefined = node.children[index]
    if (child === undefined) {
      degraded = true
      break
    }
    node = child
    nodeStart = startOffsetOf(child)
  }
  // path 失效 → 最近可解析祖先块首（architecture.md 3.4 第 3 条）
  if (degraded) return nodeStart
  // path 有效但 offset 超出节点 end → clamp 到 end（评审顺延②，登记用例见测试）
  const end = node.position?.end.offset
  const resolved = nodeStart + cursor.offset
  if (end !== undefined && resolved > end) return end
  return resolved
}

// ===== PM bridge（Task 2）：PM pos ↔ Markdown offset lockstep 映射 =====

interface Anchor {
  pm: number
  md: number
  exact: boolean
}

/** PM 文本区 ↔ md 叶子内容区（逐字符精确对应）。 */
interface TextRegion {
  pmStart: number
  mdStart: number
  length: number
}

/** 结构不对应的 PM 块区间 → 统一映射到块首 offset。 */
interface FallbackRegion {
  pmStart: number
  pmEnd: number
  mdOffset: number
}

interface LockstepMap {
  anchorsByPm: Anchor[]
  anchorsByMd: Anchor[]
  textRegions: TextRegion[]
  fallbacks: FallbackRegion[]
}

type InlineLeafKind = 'text' | 'code' | 'image' | 'break' | 'html' | 'other'

interface InlineLeaf {
  kind: InlineLeafKind
  value: string
  start: number
  end: number
  contentStart: number
  aligned: boolean
  wrappers: string[]
}

const MARK_TO_WRAPPER: Record<string, string> = {
  strong: 'strong',
  emphasis: 'emphasis',
  strike_through: 'delete',
  link: 'link',
}

const BLOCK_KINDS: Record<string, string> = {
  paragraph: 'paragraph',
  heading: 'heading',
  blockquote: 'blockquote',
  bullet_list: 'list',
  ordered_list: 'list',
  list_item: 'listItem',
  code_block: 'code',
  table: 'table',
  table_row: 'tableRow',
  table_header_row: 'tableRow',
  table_cell: 'tableCell',
  table_header: 'tableCell',
  html: 'html',
  hr: 'thematicBreak',
  footnote_definition: 'footnoteDefinition',
}

function buildLockstepMap(markdown: string, doc: PMNode, root: Root): LockstepMap {
  const anchorByPm = new Map<number, Anchor>()
  const textRegions: TextRegion[] = []
  const fallbacks: FallbackRegion[] = []
  const recordAnchor = (pm: number, md: number, exact: boolean): void => {
    anchorByPm.set(pm, { pm, md, exact })
  }
  recordAnchor(0, startOffsetOf(root), false)

  function flattenInline(
    children: readonly RootContent[],
    wrappers: string[],
    out: InlineLeaf[],
  ): void {
    for (const child of children) {
      const start = startOffsetOf(child)
      const end = endOffsetOf(child)
      switch (child.type) {
        case 'text': {
          const value = child.value
          const aligned = markdown.slice(start, end) === value
          out.push({ kind: 'text', value, start, end, contentStart: start, aligned, wrappers })
          break
        }
        case 'inlineCode': {
          const value = child.value
          const idx = value ? markdown.indexOf(value, start) : -1
          const aligned = idx !== -1 && idx + value.length <= end
          out.push({
            kind: 'code',
            value,
            start,
            end,
            contentStart: aligned ? idx : start,
            aligned,
            wrappers: [...wrappers, 'inlineCode'],
          })
          break
        }
        case 'strong':
        case 'emphasis':
        case 'link':
        case 'delete':
          if (isParent(child)) flattenInline(child.children, [...wrappers, child.type], out)
          break
        case 'image':
          out.push({
            kind: 'image',
            value: '',
            start,
            end,
            contentStart: start,
            aligned: true,
            wrappers,
          })
          break
        case 'break':
          out.push({
            kind: 'break',
            value: '',
            start,
            end,
            contentStart: start,
            aligned: true,
            wrappers,
          })
          break
        case 'html':
          out.push({
            kind: 'html',
            value: child.value,
            start,
            end,
            contentStart: start,
            aligned: true,
            wrappers,
          })
          break
        default:
          out.push({
            kind: 'other',
            value: '',
            start,
            end,
            contentStart: start,
            aligned: false,
            wrappers,
          })
      }
    }
  }

  function walkCodeBlock(pmCode: PMNode, mdCode: MdastNode, pmPos: number): void {
    const value = mdCode.type === 'code' ? mdCode.value : ''
    const start = startOffsetOf(mdCode)
    const end = endOffsetOf(mdCode)
    const contentSize = pmCode.content.size
    const contentStart = pmPos + 1
    const contentEnd = pmPos + pmCode.nodeSize - 1
    const valueStart = value ? markdown.indexOf(value, start) : -1
    const atLineStart = valueStart <= 0 || markdown[valueStart - 1] === '\n'
    if (
      !value ||
      valueStart === -1 ||
      valueStart + value.length > end ||
      contentSize !== value.length ||
      !atLineStart
    ) {
      fallbacks.push({ pmStart: contentStart, pmEnd: contentEnd, mdOffset: start })
      return
    }
    textRegions.push({ pmStart: contentStart, mdStart: valueStart, length: contentSize })
    recordAnchor(contentStart, valueStart, true)
    recordAnchor(contentEnd, valueStart + contentSize, true)
  }

  function walkInline(pmParent: PMNode, mdParent: MdastNode, pmContentStart: number): void {
    const pmChildren: PMNode[] = []
    pmParent.forEach((child) => pmChildren.push(child))
    const mdChildren = isParent(mdParent) ? mdParent.children : []
    const leaves: InlineLeaf[] = []
    flattenInline(mdChildren, [], leaves)
    const parentContentEnd = pmContentStart + pmParent.content.size
    let pmPos = pmContentStart
    for (let i = 0; i < pmChildren.length; i++) {
      const pmChild = pmChildren[i]
      const leaf = leaves[i]
      const pmEnd = pmChild.isText ? pmPos + (pmChild.text?.length ?? 0) : pmPos + pmChild.nodeSize
      if (!leaf) {
        // PM 比 mdast 叶子多（如未识别节点被丢弃）：余下区间退化为最近文本边界
        fallbacks.push({ pmStart: pmPos, pmEnd: parentContentEnd, mdOffset: endOffsetOf(mdParent) })
        break
      }
      if (pmChild.isText) {
        const text = pmChild.text ?? ''
        const marks = pmChild.marks.map((mark) => mark.type.name)
        const isCode = marks.includes('inlineCode')
        const kindMatch = leaf.kind === (isCode ? 'code' : 'text')
        const marksMatch = marks.every((mark) => {
          if (mark === 'inlineCode') return true
          const wrapper = MARK_TO_WRAPPER[mark]
          return wrapper !== undefined && leaf.wrappers.includes(wrapper)
        })
        if (!kindMatch || !leaf.aligned || leaf.value.length !== text.length || !marksMatch) {
          recordAnchor(pmPos, leaf.contentStart, false)
          fallbacks.push({ pmStart: pmPos, pmEnd, mdOffset: leaf.contentStart })
        } else {
          textRegions.push({ pmStart: pmPos, mdStart: leaf.contentStart, length: text.length })
          recordAnchor(pmPos, leaf.contentStart, true)
          // 末尾边界仅在最后一个 child 记录：中间边界归下一个 child 的起点锚点
          if (i === pmChildren.length - 1) {
            recordAnchor(pmPos + text.length, leaf.contentStart + text.length, true)
          }
        }
      } else {
        // image / hardbreak / html 等原子节点：前后边界锚到叶子 range
        recordAnchor(pmPos, leaf.start, false)
        recordAnchor(pmPos + pmChild.nodeSize, leaf.end, false)
      }
      pmPos = pmEnd
    }
  }

  function walkPair(pmChild: PMNode, mdChild: MdastNode, pmPos: number): void {
    switch (pmChild.type.name) {
      case 'code_block':
        walkCodeBlock(pmChild, mdChild, pmPos)
        break
      case 'paragraph':
      case 'heading':
        walkInline(pmChild, mdChild, pmPos + 1)
        break
      case 'table_cell':
      case 'table_header': {
        // PM 单元格内容是 paragraph，mdast tableCell 直接是行内内容
        const inner = pmChild.childCount > 0 ? pmChild.child(0) : undefined
        if (inner !== undefined && inner.type.name === 'paragraph') {
          walkInline(inner, mdChild, pmPos + 2)
        } else {
          fallbacks.push({
            pmStart: pmPos + 1,
            pmEnd: pmPos + pmChild.nodeSize - 1,
            mdOffset: startOffsetOf(mdChild),
          })
        }
        break
      }
      default:
        if (isParent(mdChild)) walkBlockChildren(pmChild, mdChild, pmPos + 1)
        break
    }
  }

  function walkBlockChildren(pmParent: PMNode, mdParent: MdastNode, pmContentStart: number): void {
    const pmChildren: PMNode[] = []
    pmParent.forEach((child) => pmChildren.push(child))
    const mdChildren = isParent(mdParent) ? mdParent.children : []
    const lastMd = mdChildren.length > 0 ? mdChildren[mdChildren.length - 1] : undefined
    let pmPos = pmContentStart
    for (let i = 0; i < pmChildren.length; i++) {
      const pmChild = pmChildren[i]
      const mdChild = mdChildren[i]
      const pmEnd = pmPos + pmChild.nodeSize
      if (mdChild === undefined || BLOCK_KINDS[pmChild.type.name] !== mdChild.type) {
        // kind 不对应（如 html 块被包进 paragraph、footnote 边角）→ 顶层块级 fallback 到块首
        const mdOffset = mdChild
          ? startOffsetOf(mdChild)
          : lastMd
            ? endOffsetOf(lastMd)
            : endOffsetOf(mdParent)
        recordAnchor(pmPos, mdOffset, false)
        fallbacks.push({ pmStart: pmPos, pmEnd, mdOffset })
        pmPos = pmEnd
        continue
      }
      recordAnchor(pmPos, startOffsetOf(mdChild), false)
      walkPair(pmChild, mdChild, pmPos)
      pmPos = pmEnd
    }
  }

  walkBlockChildren(doc, root, 0)
  recordAnchor(doc.content.size, endOffsetOf(root), false)

  const anchors = [...anchorByPm.values()]
  const anchorsByPm = [...anchors].sort((a, b) => a.pm - b.pm)
  const anchorsByMd = [...anchors]
    .sort((a, b) => a.md - b.md || a.pm - b.pm)
    .filter((anchor, index, sorted) => index === 0 || sorted[index - 1].md !== anchor.md)
  return { anchorsByPm, anchorsByMd, textRegions, fallbacks }
}

function nearestAnchor(anchors: readonly Anchor[], key: number, axis: 'pm' | 'md'): Anchor {
  let best = anchors[0]
  let bestDist = Number.POSITIVE_INFINITY
  for (const anchor of anchors) {
    const dist = Math.abs(key - (axis === 'pm' ? anchor.pm : anchor.md))
    // 平局取后方（排序靠后的锚点）
    if (dist <= bestDist) {
      best = anchor
      bestDist = dist
    }
  }
  return best
}

function offsetFromPmPos(map: LockstepMap, pos: number): number {
  for (const fallback of map.fallbacks) {
    if (pos >= fallback.pmStart && pos < fallback.pmEnd) return fallback.mdOffset
  }
  for (const region of map.textRegions) {
    if (pos >= region.pmStart && pos < region.pmStart + region.length) {
      return region.mdStart + (pos - region.pmStart)
    }
  }
  return nearestAnchor(map.anchorsByPm, pos, 'pm').md
}

function pmPosFromOffset(map: LockstepMap, offset: number): PositionResult {
  for (const region of map.textRegions) {
    if (offset >= region.mdStart && offset < region.mdStart + region.length) {
      return { pos: region.pmStart + (offset - region.mdStart), accuracy: 'exact' }
    }
  }
  const anchor = nearestAnchor(map.anchorsByMd, offset, 'md')
  const accuracy: CursorAccuracy = anchor.exact && offset === anchor.md ? 'exact' : 'ancestor'
  return { pos: anchor.pm, accuracy }
}

function clampPm(doc: PMNode, pos: number): number {
  return Math.min(Math.max(pos, 0), doc.content.size)
}

export function pmPosToMarkdownOffset(markdown: string, doc: PMNode, pos: number): number {
  const root = parser.parse(markdown)
  return offsetFromPmPos(buildLockstepMap(markdown, doc, root), clampPm(doc, pos))
}

export function markdownOffsetToPmPos(
  markdown: string,
  doc: PMNode,
  offset: number,
): PositionResult {
  const root = parser.parse(markdown)
  return pmPosFromOffset(buildLockstepMap(markdown, doc, root), clampMd(markdown, offset))
}

export function pmPosToMdCursor(markdown: string, doc: PMNode, pos: number): MdCursor {
  const root = parser.parse(markdown)
  const map = buildLockstepMap(markdown, doc, root)
  return cursorFromOffset(root, offsetFromPmPos(map, clampPm(doc, pos)))
}

export function mdCursorToPmPos(markdown: string, doc: PMNode, cursor: MdCursor): PositionResult {
  const root = parser.parse(markdown)
  const offset = offsetFromCursor(root, cursor)
  return pmPosFromOffset(buildLockstepMap(markdown, doc, root), clampMd(markdown, offset))
}
