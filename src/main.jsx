import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { evictStale } from './lib/cache.js'
import './styles/base.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Housekeeping, deliberately after first paint and deliberately unawaited —
// a slow or unavailable IndexedDB must never delay the app appearing.
requestIdleCallbackShim(() => { evictStale() })

function requestIdleCallbackShim(fn) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn)
  else setTimeout(fn, 2000)
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // An unavailable service worker costs offline support, not the app.
    })
  })
}
