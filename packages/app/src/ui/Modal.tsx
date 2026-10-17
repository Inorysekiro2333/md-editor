interface ModalProps {
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm(): void
  onCancel(): void
}

export function Modal({ message, confirmLabel, cancelLabel, onConfirm, onCancel }: ModalProps) {
  return (
    <div className="modal-backdrop" data-testid="modal">
      <div className="modal" role="dialog" aria-modal="true">
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button type="button" data-testid="modal-confirm" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" data-testid="modal-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
