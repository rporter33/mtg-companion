import Sheet from './Sheet.jsx'

/**
 * A question with its consequence in it.
 *
 * The house style, taken from the one dialog in the Moxgate study worth
 * stealing outright (docs/table-rebuild/TARGET.md §3): the title is the
 * situation, the body is what will happen, and every button says what
 * pressing it does. Never "Are you sure?", never OK and Cancel — a person
 * reading only the buttons should still know what they are choosing.
 *
 *   <Confirm
 *     open={deleting}
 *     title="Delete Elves Forever"
 *     actions={[
 *       { label: 'Delete Elves Forever', kind: 'danger', onPress: remove },
 *       { label: 'Keep it', onPress: close },
 *     ]}
 *     onClose={close}
 *   >
 *     The deck and every version of it go. This cannot be undone.
 *   </Confirm>
 *
 * The first action is the one the dialog exists for and is drawn as such;
 * the last is the way out, and Escape and the scrim do the same as it.
 */
export default function Confirm({ open, title, children, actions = [], onClose }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} size="sm">
      <div className="confirm">
        {children && <div className="confirm__body">{children}</div>}
        <div className="confirm__actions">
          {actions.map((action, i) => (
            <button
              key={action.label}
              type="button"
              className={`btn ${action.kind === 'danger' ? 'btn--danger' : action.kind === 'primary' || (i === 0 && !action.kind) ? 'btn--primary' : 'btn--ghost'}`}
              onClick={action.onPress}
              autoFocus={action.focus}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  )
}
