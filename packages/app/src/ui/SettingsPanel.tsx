import { THEME_IDS, type ThemeId } from '@md-editor/theming'

const THEME_LABELS: Record<ThemeId, string> = {
  'github-light': 'GitHub 浅色',
  'github-dark': 'GitHub 深色',
  'paper-serif': '纸感衬线',
}

interface SettingsPanelProps {
  initialTheme: ThemeId
  printBackground: boolean
  onChangeTheme(theme: ThemeId): void
  onChangePrintBackground(printBackground: boolean): void
  onClose(): void
}

export function SettingsPanel({
  initialTheme,
  printBackground,
  onChangeTheme,
  onChangePrintBackground,
  onClose,
}: SettingsPanelProps) {
  return (
    <div className="modal-backdrop" data-testid="settings-backdrop">
      <div className="modal settings-panel" role="dialog" aria-modal="true" aria-label="设置">
        <p className="modal-message">设置</p>
        <fieldset className="settings-group">
          <legend>主题</legend>
          {THEME_IDS.map((id) => (
            <label key={id} className="settings-option">
              <input
                type="radio"
                name="theme-id"
                checked={initialTheme === id}
                onChange={() => onChangeTheme(id)}
                data-testid={`theme-${id}`}
              />
              {THEME_LABELS[id]}
            </label>
          ))}
        </fieldset>
        <fieldset className="settings-group">
          <legend>导出</legend>
          <label className="settings-option">
            <input
              type="checkbox"
              checked={printBackground}
              onChange={(event) => onChangePrintBackground(event.target.checked)}
              data-testid="pdf-print-background"
            />
            导出 PDF 包含背景
          </label>
        </fieldset>
        <div className="modal-actions">
          <button type="button" data-testid="settings-close" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
