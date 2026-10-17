/**
 * outline：Markdown Buffer 的大纲解析（纯 remark 函数，禁 PM doc 派生）。
 *
 * 规则（M3 计划 Task 3 写死）：
 * - 管线 unified().use(remarkParse).use(remarkGfm)，与 cursor-map 同源；
 * - 只遍历 root 顶层 children：引述、列表等容器内的标题不算；
 * - fenced code 内 `#` 行 remark 自动识别为 code 节点，天然不算；
 * - ATX 与 setext 均收：offset = 标题 mdast position.start.offset（含 `# ` 标记），
 *   ATX 的 textOffset = offset + level + 1，setext 的 textOffset = offset；
 * - text 取 children 纯文本拼接（递归取 text 节点 value，inline code 取 value 原样）。
 * - 纯函数：无 DOM、无 IO；模块级仅缓存一个 immutable parser 实例。
 */
import type { Nodes } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

export interface OutlineItem {
  level: number
  text: string
  offset: number
  textOffset: number
}

function textOf(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  let out = ''
  if ('children' in node) {
    for (const child of node.children) out += textOf(child)
  }
  return out
}

const parser = unified().use(remarkParse).use(remarkGfm)

export function parseOutline(markdown: string): OutlineItem[] {
  const root = parser.parse(markdown)
  const items: OutlineItem[] = []
  for (const child of root.children) {
    if (child.type !== 'heading') continue
    const offset = child.position?.start.offset ?? 0
    // ATX 行首是 `#`；setext 无 `#` 前缀，textOffset 即标题起点
    const textOffset = markdown[offset] === '#' ? offset + child.depth + 1 : offset
    items.push({ level: child.depth, text: textOf(child), offset, textOffset })
  }
  return items
}
