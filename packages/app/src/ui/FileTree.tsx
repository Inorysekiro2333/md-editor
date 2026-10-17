import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceNode } from '../bridge'
import { visibleRange } from './visibleRange'

const ROW_HEIGHT = 24
const OVERSCAN = 8

export interface FlatRow {
  node: WorkspaceNode
  depth: number
}

/** 深度优先扁平化；目录默认展开（expanded 缺省视为展开）。 */
export function flattenTree(nodes: WorkspaceNode[], expanded: Map<string, boolean>): FlatRow[] {
  const rows: FlatRow[] = []
  const visit = (list: WorkspaceNode[], depth: number): void => {
    for (const node of list) {
      rows.push({ node, depth })
      if (node.type === 'dir' && node.children !== undefined && expanded.get(node.path) !== false) {
        visit(node.children, depth + 1)
      }
    }
  }
  visit(nodes, 0)
  return rows
}

function sortSiblings(nodes: WorkspaceNode[]): WorkspaceNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function insertAt(
  nodes: WorkspaceNode[],
  parentPath: string,
  sep: string,
  segments: string[],
  level: number,
): WorkspaceNode[] {
  const name = segments[level] as string
  const isLast = level === segments.length - 1
  const path = `${parentPath}${sep}${name}`
  if (isLast) {
    if (nodes.some((node) => node.path === path)) return nodes
    return sortSiblings([...nodes, { name, path, type: 'file' }])
  }
  const existing = nodes.find((node) => node.type === 'dir' && node.name === name)
  if (existing !== undefined && existing.children !== undefined) {
    const children = insertAt(existing.children, existing.path, sep, segments, level + 1)
    if (children === existing.children) return nodes
    return sortSiblings(nodes.map((node) => (node === existing ? { ...node, children } : node)))
  }
  return sortSiblings([
    ...nodes,
    { name, path, type: 'dir', children: insertAt([], path, sep, segments, level + 1) },
  ])
}

/** 增量 add：按相对路径插入文件节点（缺失的中间目录一并创建并排序）。 */
export function insertIntoTree(
  nodes: WorkspaceNode[],
  added: string[],
  rootPath: string,
): WorkspaceNode[] {
  const sep = rootPath.includes('\\') ? '\\' : '/'
  const rootPrefix = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`
  let tree = nodes
  for (const fullPath of added) {
    if (!fullPath.startsWith(rootPrefix)) continue
    const relative = fullPath.slice(rootPrefix.length)
    const segments = relative.split(/[\\/]+/).filter((segment) => segment !== '')
    if (segments.length === 0) continue
    tree = insertAt(tree, rootPath, sep, segments, 0)
  }
  return tree
}

interface FileTreeProps {
  nodes: WorkspaceNode[]
  onOpenFile(path: string): void
}

export function FileTree({ nodes, onOpenFile }: FileTreeProps) {
  const [expanded, setExpanded] = useState<Map<string, boolean>>(() => new Map())
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const rows = useMemo(() => flattenTree(nodes, expanded), [nodes, expanded])
  const range = visibleRange(scrollTop, viewportHeight, ROW_HEIGHT, rows.length, OVERSCAN)

  const measure = useCallback((): void => {
    setViewportHeight(containerRef.current?.clientHeight ?? 0)
  }, [])

  useEffect(() => {
    measure()
    const container = containerRef.current
    if (container === null) return
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [measure])

  const toggleDir = useCallback((node: WorkspaceNode): void => {
    setExpanded((previous) => {
      const next = new Map(previous)
      next.set(node.path, !(previous.get(node.path) ?? true))
      return next
    })
  }, [])

  return (
    <div
      className="file-tree"
      data-testid="file-tree"
      ref={containerRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ position: 'relative', height: rows.length * ROW_HEIGHT }}>
        {rows.slice(range.start, range.end).map((row, index) => (
          <button
            key={row.node.path}
            type="button"
            className="file-row"
            data-testid="file-row"
            data-path={row.node.path}
            data-type={row.node.type}
            style={{
              position: 'absolute',
              top: (range.start + index) * ROW_HEIGHT,
              height: ROW_HEIGHT,
              left: 0,
              right: 0,
              paddingLeft: 8 + row.depth * 12,
            }}
            onClick={() =>
              row.node.type === 'dir' ? toggleDir(row.node) : onOpenFile(row.node.path)
            }
          >
            {row.node.name}
          </button>
        ))}
      </div>
    </div>
  )
}
