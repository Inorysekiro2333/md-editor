import { t } from '../i18n'

interface AboutDialogProps {
  version: string
  electron: string
  chromium: string
  onClose(): void
}

export function AboutDialog({ version, electron, chromium, onClose }: AboutDialogProps) {
  return (
    <div className="modal-backdrop" data-testid="about-backdrop">
      <div
        className="modal settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('aboutTitle')}
      >
        <p className="modal-message">{t('aboutTitle')}</p>
        <dl className="settings-group" data-testid="about-info">
          <div className="settings-option">
            <dt>{t('aboutVersion')}</dt>
            <dd data-testid="about-version">{version}</dd>
          </div>
          <div className="settings-option">
            <dt>Electron</dt>
            <dd data-testid="about-electron">{electron}</dd>
          </div>
          <div className="settings-option">
            <dt>Chromium</dt>
            <dd data-testid="about-chromium">{chromium}</dd>
          </div>
        </dl>
        <div className="modal-actions">
          <button type="button" data-testid="about-close" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
