import type { FormatCommandName } from '@md-editor/editor'
import { useState } from 'react'
import { t } from '../i18n'

interface FormatButton {
  name: FormatCommandName
  label: string
  shortcut?: string
  glyph: string
  glyphClass?: string
}

const BUTTONS: FormatButton[][] = [
  [
    {
      name: 'bold',
      label: t('formatBold'),
      shortcut: 'Ctrl+B',
      glyph: 'B',
      glyphClass: 'glyph-bold',
    },
    {
      name: 'italic',
      label: t('formatItalic'),
      shortcut: 'Ctrl+I',
      glyph: 'I',
      glyphClass: 'glyph-italic',
    },
    {
      name: 'strikethrough',
      label: t('formatStrike'),
      shortcut: 'Ctrl+Shift+X',
      glyph: 'S',
      glyphClass: 'glyph-strike',
    },
    {
      name: 'inlineCode',
      label: t('formatInlineCode'),
      shortcut: 'Ctrl+E',
      glyph: '<>',
      glyphClass: 'glyph-mono',
    },
  ],
  [
    { name: 'orderedList', label: t('formatOrderedList'), glyph: '1.' },
    { name: 'bulletList', label: t('formatBulletList'), glyph: '•' },
    { name: 'blockquote', label: t('formatBlockquote'), glyph: '❝' },
    { name: 'insertTable', label: t('formatInsertTable'), glyph: '▦' },
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
      aria-label={t('formatToolbar')}
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
              aria-label={t('headingLevel')}
              title={t('headingLevelTitle')}
              data-testid="heading-select"
              value={heading}
              disabled={disabled}
              onChange={(event) => {
                const value = event.target.value
                setHeading('')
                if (value === 'h1' || value === 'h2' || value === 'h3') onCommand(value)
              }}
            >
              <option value="">{t('heading')}</option>
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
