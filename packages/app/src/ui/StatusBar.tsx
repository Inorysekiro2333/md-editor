import { t } from '../i18n'

/**
 * M5.x 底部状态栏：左=保存状态点 + 状态消息；右=编辑模式分段控件 + 设置入口。
 * 分段控件沿用既有 toggleMode 语义（点击任一段都会切换模式），aria-pressed 表达激活态。
 * 注意：激活段点击必须保持 toggle 行为——e2e source-mode.spec 依赖此语义，勿改为 no-op。
 * title 一律描述点击后的目标模式，避免激活段被屏幕阅读器播报出自相矛盾的可访问名。
 */
export function StatusBar(props: {
  status: string
  dirty: boolean
  mode: 'wysiwyg' | 'source'
  onToggleMode(): void
  onOpenSettings(): void
}): JSX.Element {
  const { status, dirty, mode, onToggleMode, onOpenSettings } = props
  // 两段点击等价（都触发 onToggleMode），可访问名统一描述目标模式。
  const toggleTitle = mode === 'wysiwyg' ? t('toggleToSource') : t('toggleToWysiwyg')
  return (
    <footer className="statusbar">
      <span className="statusbar-status" data-testid="status">
        <span className={dirty ? 'status-dot dirty' : 'status-dot'} aria-hidden="true" />
        {dirty ? `${t('dirty')} · ` : ''}
        {status}
      </span>
      <span className="statusbar-right">
        <span className="statusbar-segment">
          <button
            type="button"
            className="statusbar-segment-btn"
            aria-pressed={mode === 'wysiwyg'}
            data-testid={mode === 'wysiwyg' ? 'mode-toggle' : undefined}
            title={toggleTitle}
            onClick={onToggleMode}
          >
            {t('modeWysiwyg')}
          </button>
          <button
            type="button"
            className="statusbar-segment-btn"
            aria-pressed={mode === 'source'}
            data-testid={mode === 'source' ? 'mode-toggle' : undefined}
            title={toggleTitle}
            onClick={onToggleMode}
          >
            {t('modeSource')}
          </button>
        </span>
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
