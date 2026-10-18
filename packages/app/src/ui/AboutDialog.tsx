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
        aria-label="关于 md-editor"
      >
        <p className="modal-message">关于 md-editor</p>
        <dl className="settings-group" data-testid="about-info">
          <div className="settings-option">
            <dt>版本</dt>
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
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
