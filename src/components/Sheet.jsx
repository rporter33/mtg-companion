import { useEffect, useRef } from 'react'
import './sheet.css'

/**
 * A bottom sheet on phones, a centred dialog on wide screens.
 * Traps focus and restores it on close, because the card detail view is the
 * most-opened thing in the app and losing your place in a long list is awful.
 */
export default function Sheet({ open, onClose, title, children, size = 'md' }) {
  const ref = useRef(null)
  const restoreTo = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    restoreTo.current = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = ref.current?.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    // Focus the panel itself rather than its first control, so screen readers
    // announce the title before the user starts tabbing.
    ref.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      if (restoreTo.current instanceof HTMLElement) restoreTo.current.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="sheet__scrim" onClick={onClose}>
      <div
        className={`sheet sheet--${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet__header">
          <div className="sheet__grabber" aria-hidden="true" />
          <h2>{title}</h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  )
}
