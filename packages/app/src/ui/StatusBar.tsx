import { t } from '../i18n'

/** M5.x 底部状态栏：左=未保存标记 + 最近状态消息；右=编辑模式切换 + 设置入口。 */
export function StatusBar(props: {
  status: string
  dirty: boolean
  mode: 'wysiwyg' | 'source'
  onToggleMode(): void
  onOpenSettings(): void
}): JSX.Element {
  const { status, dirty, mode, onToggleMode, onOpenSettings } = props
  return (
    <footer className="statusbar">
      <span data-testid="status">
        {dirty ? `${t('dirty')} · ` : ''}
        {status}
      </span>
      <span className="statusbar-right">
        <button
          type="button"
          data-testid="mode-toggle"
          title={mode === 'wysiwyg' ? t('toggleToSource') : t('toggleToWysiwyg')}
          onClick={onToggleMode}
        >
          {mode === 'wysiwyg' ? t('modeWysiwyg') : t('modeSource')}
        </button>
        <button
          type="button"
          data-testid="open-settings"
          className="statusbar-gear"
          aria-label={t('settings')}
          title={t('settings')}
          onClick={onOpenSettings}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </span>
    </footer>
  )
}
