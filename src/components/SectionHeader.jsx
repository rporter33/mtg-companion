/**
 * A section's heading line: title, count, then whatever sits at the right
 * — a total, a menu. The rule across the app is that the title and count
 * hug the left and the rest floats right with a hairline between.
 */
export default function SectionHeader({ title, count, children, as: Tag = 'h2' }) {
  return (
    <div className="section-title">
      <Tag>{title}</Tag>
      {count !== undefined && <span className="faint">{count}</span>}
      <span className="spacer" />
      {children}
    </div>
  )
}
