import { THEME_IDS, type ThemeId } from '@md-editor/theming'
import { t } from '../i18n'

const THEME_LABELS: Record<ThemeId, string> = {
  'github-light': t('themeGithubLight'),
  'github-dark': t('themeGithubDark'),
  'paper-serif': t('themePaperSerif'),
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
      <div
        className="modal settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('settingsTitle')}
      >
        <p className="modal-message">{t('settingsTitle')}</p>
        <fieldset className="settings-group">
          <legend>{t('settingsTheme')}</legend>
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
          <legend>{t('settingsExport')}</legend>
          <label className="settings-option">
            <input
              type="checkbox"
              checked={printBackground}
              onChange={(event) => onChangePrintBackground(event.target.checked)}
              data-testid="pdf-print-background"
            />
            {t('settingsPdfBackground')}
          </label>
        </fieldset>
        <div className="modal-actions">
          <button type="button" data-testid="settings-close" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
