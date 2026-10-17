import { parseOutline, type OutlineItem } from '@md-editor/editor'
import { useMemo } from 'react'

interface OutlinePanelProps {
  markdown: string
  cursorOffset: number | null
  onJump(item: OutlineItem): void
}

/**
 * 大纲面板：parseOutline（纯 remark，Buffer 派生）+ 光标跟随高亮。
 * 高亮语义（M3 计划 Task 3）：active = 最后一个满足 cursorOffset >= item.offset 的项。
 */
export function OutlinePanel({ markdown, cursorOffset, onJump }: OutlinePanelProps): JSX.Element {
  const items = useMemo(() => parseOutline(markdown), [markdown])
  let activeOffset: number | null = null
  if (cursorOffset !== null) {
    for (const item of items) {
      if (cursorOffset >= item.offset) activeOffset = item.offset
    }
  }
  if (items.length === 0) {
    return <p className="outline-empty">无标题</p>
  }
  return (
    <ul className="outline">
      {items.map((item) => (
        <li key={`${item.offset}`} className={`outline-level-${item.level}`}>
          <button
            type="button"
            data-testid="outline-item"
            data-active={item.offset === activeOffset ? 'true' : undefined}
            onClick={() => onJump(item)}
          >
            {item.text}
          </button>
        </li>
      ))}
    </ul>
  )
}
