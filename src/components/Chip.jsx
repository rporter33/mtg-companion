/**
 * A chip that is a control. `pressed` makes it a toggle with aria-pressed
 * and the active style; without it, it is a plain chip button. Chips that
 * are only labels stay as spans with the class, since a label is not a
 * button.
 */
export default function Chip({ pressed, small = false, className = '', children, ...rest }) {
  const toggle = pressed !== undefined
  return (
    <button
      type="button"
      className={`chip ${small ? 'chip--sm' : ''} ${toggle && pressed ? 'chip--active' : ''} ${className}`}
      aria-pressed={toggle ? pressed : undefined}
      {...rest}
    >
      {children}
    </button>
  )
}
