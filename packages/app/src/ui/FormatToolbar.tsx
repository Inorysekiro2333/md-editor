import type { FormatCommandName } from '@md-editor/editor'
import { useState } from 'react'

interface FormatButton {
  name: FormatCommandName
  label: string
  shortcut?: string
  glyph: string
  glyphClass?: string
}

const BUTTONS: FormatButton[][] = [
  [
    { name: 'bold', label: '加粗', shortcut: 'Ctrl+B', glyph: 'B', glyphClass: 'glyph-bold' },
    { name: 'italic', label: '斜体', shortcut: 'Ctrl+I', glyph: 'I', glyphClass: 'glyph-italic' },
    {
      name: 'strikethrough',
      label: '删除线',
      shortcut: 'Ctrl+Shift+X',
      glyph: 'S',
      glyphClass: 'glyph-strike',
    },
    {
      name: 'inlineCode',
      label: '行内代码',
      shortcut: 'Ctrl+E',
      glyph: '<>',
      glyphClass: 'glyph-mono',
    },
  ],
  [
    { name: 'orderedList', label: '有序列表', glyph: '1.' },
    { name: 'bulletList', label: '无序列表', glyph: '•' },
    { name: 'blockquote', label: '引用', glyph: '❝' },
    { name: 'insertTable', label: '插入表格', glyph: '▦' },
  ],
]

/**
 * M5.x 格式工具栏：仅 Markdown 语义项。
 * 所有命令经编辑器统一命令入口作用于 Buffer（sync 事务），两种模式等价。
 */
export function FormatToolbar(props: {
  disabled?: boolean
  onCommand(name: FormatCommandName): void
}): JSX.Element {
  const { disabled = false, onCommand } = props
  const [heading, setHeading] = useState('')

  return (
    <div
      className="format-toolbar"
      role="toolbar"
      aria-label="格式工具栏"
      data-testid="format-toolbar"
    >
      {BUTTONS.map((group, groupIndex) => (
        <span className="format-toolbar-group" key={groupIndex}>
          {group.map((button) => {
            const title = button.shortcut ? `${button.label} (${button.shortcut})` : button.label
            return (
              <button
                key={button.name}
                type="button"
                className="format-toolbar-btn"
                title={title}
                aria-label={title}
                disabled={disabled}
                onClick={() => onCommand(button.name)}
              >
                <span className={button.glyphClass ?? ''}>{button.glyph}</span>
              </button>
            )
          })}
          {groupIndex === 0 ? (
            <select
              className="format-toolbar-heading"
              aria-label="标题级别"
              title="标题级别 (H1–H3)"
              data-testid="heading-select"
              value={heading}
              disabled={disabled}
              onChange={(event) => {
                const value = event.target.value
                setHeading('')
                if (value === 'h1' || value === 'h2' || value === 'h3') onCommand(value)
              }}
            >
              <option value="">标题</option>
              <option value="h1">H1</option>
              <option value="h2">H2</option>
              <option value="h3">H3</option>
            </select>
          ) : null}
        </span>
      ))}
    </div>
  )
}
