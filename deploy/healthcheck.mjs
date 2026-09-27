#!/usr/bin/env node
/**
 * The image's health check (deploy/Dockerfile's HEALTHCHECK): the relay's own
 * GET /health, asked inside the container on the port it listens on. Healthy
 * when it answers `ok: true`, whatever else it says.
 *
 * `engine: true` in that answer means an engine is configured — ENGINE_CMD names
 * a launcher — not that one is running or has its cards loaded: an engine starts
 * when a deck is first checked or a room is sat at, and takes 25–30 s to load the
 * card corpus before its first answer (PLAN.md, M8). So healthy means the relay
 * is up and answering; the first game of the day still waits on the corpus.
 *
 * Node's own fetch rather than curl or wget, which the slim base image has not
 * got and which would be one more thing in the image to keep patched.
 */
const port = Number(process.env.PORT) || 8788
try {
  const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(4000) })
  const body = await res.json()
  if (!res.ok || body?.ok !== true) throw new Error(`/health answered ${res.status} ${JSON.stringify(body)}`)
  console.log(`healthy: ${body.rooms} room(s), engine ${body.engine ? 'configured' : 'none'}`)
  process.exit(0)
} catch (e) {
  console.log(`unhealthy: ${e.message}`)
  process.exit(1)
}
