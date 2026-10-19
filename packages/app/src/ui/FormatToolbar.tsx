import type { FormatCommandArgs, FormatCommandName } from '@md-editor/editor'
import { useState } from 'react'
import { t } from '../i18n'

/**
 * 工具栏图标（Lucide 风格）：24×24 viewBox 的 stroke path 集合，
 * 统一渲染为 16px、strokeWidth=2、currentColor 的内联 SVG，禁止文本字形。
 */
const ICON_PATHS = {
  bold: ['M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8'],
  italic: ['M19 4h-9', 'M14 20H5', 'M15 4 9 20'],
  strikethrough: ['M16 4H9a3 3 0 0 0-2.83 4', 'M14 12a4 4 0 0 1 0 8H6', 'M4 12h16'],
  inlineCode: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
  orderedList: [
    'M10 6h11',
    'M10 12h11',
    'M10 18h11',
    'M4 6h1v4',
    'M4 10h2',
    'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1',
  ],
  bulletList: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  blockquote: [
    'M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z',
    'M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z',
  ],
  table: [
    'M12 3v18',
    'M3 9h18',
    'M3 15h18',
    'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  ],
} as const

type IconName = keyof typeof ICON_PATHS

function FormatIcon({ name }: { name: IconName }): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

interface FormatButton {
  name: FormatCommandName
  label: string
  shortcut?: string
  icon: IconName
}

const BUTTONS: FormatButton[][] = [
  [
    {
      name: 'bold',
      label: t('formatBold'),
      shortcut: 'Ctrl+B',
      icon: 'bold',
    },
    {
      name: 'italic',
      label: t('formatItalic'),
      shortcut: 'Ctrl+I',
      icon: 'italic',
    },
    {
      name: 'strikethrough',
      label: t('formatStrike'),
      shortcut: 'Ctrl+Shift+X',
      icon: 'strikethrough',
    },
    {
      name: 'inlineCode',
      label: t('formatInlineCode'),
      shortcut: 'Ctrl+E',
      icon: 'inlineCode',
    },
  ],
  [
    { name: 'orderedList', label: t('formatOrderedList'), icon: 'orderedList' },
    { name: 'bulletList', label: t('formatBulletList'), icon: 'bulletList' },
    { name: 'blockquote', label: t('formatBlockquote'), icon: 'blockquote' },
    { name: 'insertTable', label: t('formatInsertTable'), icon: 'table' },
  ],
]

const GRID_SIZE = 8

/**
 * M5.x 格式工具栏：仅 Markdown 语义项。
 * 所有命令经编辑器统一命令入口作用于 Buffer（sync 事务），两种模式等价。
 */
export function FormatToolbar(props: {
  disabled?: boolean
  onCommand(name: FormatCommandName, args?: FormatCommandArgs): void
}): JSX.Element {
  const { disabled = false, onCommand } = props
  const [heading, setHeading] = useState('')
  const [tablePickerOpen, setTablePickerOpen] = useState(false)
  const [pickerRows, setPickerRows] = useState(0)
  const [pickerCols, setPickerCols] = useState(0)

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
            const isTable = button.name === 'insertTable'
            return (
              <span className="format-toolbar-slot" key={button.name}>
                <button
                  type="button"
                  className="format-toolbar-btn"
                  title={title}
                  aria-label={title}
                  aria-expanded={isTable ? tablePickerOpen : undefined}
                  disabled={disabled}
                  data-testid={isTable ? 'insert-table-btn' : undefined}
                  onClick={() =>
                    isTable ? setTablePickerOpen((open) => !open) : onCommand(button.name)
                  }
                >
                  <FormatIcon name={button.icon} />
                </button>
                {isTable && tablePickerOpen ? (
                  <div
                    className="table-picker"
                    role="menu"
                    aria-label={t('formatInsertTablePicker')}
                    data-testid="table-picker"
                  >
                    {Array.from({ length: GRID_SIZE }, (_, rowIndex) => (
                      <span className="table-picker-row" key={rowIndex}>
                        {Array.from({ length: GRID_SIZE }, (_, colIndex) => {
                          const rows = rowIndex + 1
                          const cols = colIndex + 1
                          const active = rows <= pickerRows && cols <= pickerCols
                          return (
                            <button
                              key={colIndex}
                              type="button"
                              className={active ? 'table-picker-cell active' : 'table-picker-cell'}
                              title={`${rows}×${cols}`}
                              aria-label={`${rows}x${cols}`}
                              data-testid={`table-picker-${rows}x${cols}`}
                              onMouseEnter={() => {
                                setPickerRows(rows)
                                setPickerCols(cols)
                              }}
                              onClick={() => {
                                setTablePickerOpen(false)
                                onCommand('insertTable', { rows, cols })
                              }}
                            />
                          )
                        })}
                      </span>
                    ))}
                  </div>
                ) : null}
              </span>
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
