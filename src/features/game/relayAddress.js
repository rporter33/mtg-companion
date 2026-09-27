import { getPrefs, setPref } from '../../lib/storage.js'

/**
 * The word a build carries in `VITE_RELAY_URL` to say "the relay is wherever
 * this page came from" (HANDOFF.md, M8). The image (deploy/Dockerfile) serves
 * the app from the relay itself, and that relay's public address — whatever a
 * host names the service — is not known when the image is built, so the build
 * cannot carry it; it carries this instead, and the page reads its own address.
 * The web's own name for the idea, as fetch and Referrer-Policy spell it. Read
 * forgivingly, since it is typed by hand into a build's settings: any case, with
 * a hyphen, an underscore, a space or nothing between the two words.
 */
export const SAME_ORIGIN = 'same-origin'
const saysSameOrigin = (said) => /^same[\s_-]?origin$/i.test(said)

/**
 * The folder the page was served from, which is where the relay that served it
 * answers: its origin alone where the relay serves the app at the root, as the
 * image does, and origin and path where a proxy puts the relay under one
 * (`https://host/mtg/` for the relay's `/`), which the origin alone would miss.
 * The service worker reads its own scope the same way (`public/sw.js`). A page
 * with no web address of its own (a file, `about:blank`) has none.
 */
const pageFolder = (here) => {
  if (typeof here?.href === 'string') {
    try { return new URL('.', here.href).href } catch { /* not an address: fall back to the origin */ }
  }
  return String(here?.origin ?? '')
}

/**
 * Where the relay is.
 *
 * A build can carry it (`VITE_RELAY_URL`, set where the app is built for a
 * host that runs one: an address, or `same-origin` for an app the relay serves
 * itself), and a person can set it themselves, which is how the app is used
 * against `npm run relay` on a laptop, and which wins over what the build says.
 * Nothing is assumed: with no address there is no "invite" button, and the seats
 * panel says why.
 *
 * The parameters are what it reads, there for a test to give it another build,
 * another person's settings or another page's address.
 */
export function relayAddress({ built = import.meta.env?.VITE_RELAY_URL, own = getPrefs().relayUrl, here = globalThis.location } = {}) {
  const said = String(own || built || '').trim()
  // A page opened from a file, or anywhere without an address of its own, has
  // no web address to take, which is no relay.
  const url = (saysSameOrigin(said) ? pageFolder(here) : said).replace(/\/$/, '')
  return /^https?:\/\//.test(url) ? url : null
}

export function setRelayAddress(url) {
  setPref('relayUrl', String(url ?? '').trim())
}

/** The link a friend opens to sit down at a room: this app, this room. */
export function inviteLink(code) {
  const here = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : ''
  return `${here}#/game/room/${code}`
}
