import { useSyncExternalStore } from 'react'

/**
 * Whether the table's side column — the log and the turn panel — stands beside
 * the battlefield rather than under it: the media query game.css lays the table
 * out by ("held sideways, or on a desktop"), asked of the browser here for the
 * few things that go in one place or another by it rather than only look
 * different — the first "How do you want to play?", and what a step is for.
 * The two must say the same query; game.css names this file beside its own.
 *
 * False where the browser has no `matchMedia`, as in a test's document, which
 * is the one-column table.
 */
export const SIDE_BESIDE = '(min-width: 900px), (orientation: landscape) and (min-width: 620px)'

const media = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(SIDE_BESIDE) : null)

const subscribe = (onChange) => {
  const q = media()
  if (!q?.addEventListener) return () => {}
  q.addEventListener('change', onChange)
  return () => q.removeEventListener('change', onChange)
}

export default function useSideBeside() {
  return useSyncExternalStore(subscribe, () => media()?.matches ?? false, () => false)
}
