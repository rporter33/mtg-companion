// A shared view of the collection.
//
// Ownership is edited in two places — on a card, and on a deck's missing list —
// and both have to agree immediately. Holding a copy in each component means
// marking a card owned on its page leaves the open deck still asking you to buy
// it, which reads as the app not having saved.
//
// A context provider would be the idiomatic fix and would mean threading it
// through every view that might one day touch a card. This is smaller and has
// one job: read through to storage, and tell everyone when it changes.

import { useEffect, useState } from 'react'
import { getCollection, saveCollection } from './storage.js'

const EVENT = 'mtg:collection-changed'

export function updateCollection(next) {
  saveCollection(next)
  // Same-tab only. Another tab writing localStorage does not fire this, and
  // pretending otherwise would be worse than the honest limitation.
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }))
  return next
}

export function useCollection() {
  const [collection, setCollection] = useState(() => getCollection())

  useEffect(() => {
    const onChange = (event) => setCollection(event.detail ?? getCollection())
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [])

  return [collection, updateCollection]
}
