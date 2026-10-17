export interface VisibleRange {
  start: number
  end: number
}

/** 虚拟滚动：以首个可见行为锚点，上下各扩 overscan 行，末端 clamp 到 total。 */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan = 8,
): VisibleRange {
  if (total <= 0) return { start: 0, end: 0 }
  const first = Math.floor(scrollTop / rowHeight)
  const visibleCount = Math.ceil(viewportHeight / rowHeight)
  const start = Math.max(0, first - overscan)
  const end = Math.min(total, first + visibleCount + overscan)
  return { start, end }
}
