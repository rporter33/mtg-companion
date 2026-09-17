/**
 * Fewer, count, more. One control for every place a quantity is edited —
 * list rows, grid tiles, text rows — so the labels a screen reader hears
 * and the buttons a test presses are the same everywhere.
 *
 * `compact` drops the number, for a row that shows it elsewhere. Class
 * names are the ones the rows always had, which the perf harness and the
 * specs select on.
 */
export default function Stepper({ value, name, onChange, compact = false, className = '' }) {
  return (
    <span className={`deck-row__stepper ${compact ? 'deck-row__stepper--compact' : ''} ${className}`}>
      <button className="deck-row__step" onClick={() => onChange(value - 1)} aria-label={`One fewer ${name}`}>−</button>
      {!compact && <span className="deck-row__qty">{value}</span>}
      <button className="deck-row__step" onClick={() => onChange(value + 1)} aria-label={`One more ${name}`}>+</button>
    </span>
  )
}
