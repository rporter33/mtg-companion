/**
 * Which build is this, and is there a newer one?
 *
 * GitHub Pages serves the page with a ten-minute cache, and the service
 * worker keeps a copy of the shell for offline. Between them, a reload right
 * after a deploy can quietly bring back the previous build, and nothing on
 * screen says so. This module gives the app a way to say so: the build it was
 * compiled as, and a check against the version file published beside it.
 */

/* global __BUILD__ */
export const BUILD = typeof __BUILD__ !== 'undefined'
  ? __BUILD__
  : { id: 'dev', sha: 'dev', at: null }

/** "7dbb602, published 17 Sep 2026, 06:14 UTC" — or just "dev" outside a build. */
export function describeBuild(build = BUILD) {
  if (!build?.at) return build?.sha ?? 'dev'
  const when = new Date(build.at)
  const date = Number.isNaN(when.getTime()) ? build.at : when.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  })
  return `${build.sha}, published ${date}`
}

/**
 * Is `remote` a build published after `current`? Different is not enough: a
 * CDN can serve an older version file than the code it sits beside, and that
 * must not nag anyone to reload into the past.
 */
export function isNewer(remote, current = BUILD) {
  if (!remote?.id || !remote?.at || !current?.at) return false
  if (remote.id === current.id) return false
  const a = Date.parse(remote.at)
  const b = Date.parse(current.at)
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  return a > b
}

/** Whole minutes between a build's publish time and now, for the banner. */
export function minutesAgo(build, now = Date.now()) {
  const t = Date.parse(build?.at ?? '')
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.round((now - t) / 60000))
}

/**
 * Fetches the published version file, bypassing every cache: the browser's,
 * because the point is to see past it, and the service worker's, which lets
 * this path through untouched. Returns the newer build, or null when this is
 * the latest, the file is missing (dev server), or the network is away.
 */
export async function checkForUpdate({ fetchImpl = globalThis.fetch, base = import.meta.env.BASE_URL, signal } = {}) {
  if (typeof fetchImpl !== 'function') return null
  try {
    const response = await fetchImpl(`${base}version.json`, { cache: 'no-store', signal })
    if (!response.ok) return null
    const remote = await response.json()
    return isNewer(remote) ? remote : null
  } catch {
    return null
  }
}

/**
 * Reload into the newer build. A plain reload revalidates the document, and
 * the service worker fetches navigations with revalidation too, so this is
 * enough; the hashed assets a new document names are new URLs and cannot be
 * stale.
 */
export function reloadForUpdate() {
  window.location.reload()
}
