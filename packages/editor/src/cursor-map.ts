/**
 * cursor-map remark 层：Markdown offset ↔ MdCursor 互转（纯函数）。
 *
 * 语义约定（architecture.md 3.4 / M2 计划 Task 1 的验收定义）：
 * - 所有 offset 均为 Markdown 字符串中的 UTF-16 code unit 下标。
 * - `path[i]` = 第 i 层 mdast 节点在其父节点 children 中的下标；
 *   `mdOffsetToCursor` 的解析目标是「包含该 offset 的最深 mdast 节点」，
 *   `cursor.offset` 相对该节点 `position.start.offset`。
 * - 节点边界偏好：offset == child.end 时归入该 child（offset = child.end - child.start）。
 * - `mdOffsetToCursor` 的 offset 会被钳制到 [0, 根节点 end]；空文档（''）返回 `{ path: [], offset: 0 }`。
 * - `cursorToMdOffset` 永不 throw：path 沿途任一层失效（越界、目标节点不是容器）时，
 *   逐级回退到最近可解析祖先并把 offset 归零（块首 = 该祖先 `position.start.offset`，
 *   root 视为文档起点 0）——即 architecture.md 3.4 第 3 条退化规则，对应登记用例见
 *   cursor-map.test.ts 的 degrade 用例。
 * - mdast 节点 position 可能缺省：缺省时 start/end 均按 0 处理。
 * - 纯函数：无 DOM、无 IO、无全局可变状态；模块级仅缓存一个 immutable parser 实例。
 */
import type { Root, RootContent } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

/** mdast 节点路径 + 相对最深节点起点的偏移。 */
export interface MdCursor {
  path: number[]
  offset: number
}

const parser = unified().use(remarkParse)

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
  const root = parser.parse(markdown)
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

export function cursorToMdOffset(markdown: string, cursor: MdCursor): number {
  const root = parser.parse(markdown)
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
  return degraded ? nodeStart : nodeStart + cursor.offset
}
