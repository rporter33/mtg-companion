import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Deployed to GitHub Pages at /mtg-companion/. The base path is baked into the
// bundle at build time, so dev (/) and Pages (/mtg-companion/) need different
// values — hence the mode switch rather than a hardcoded string.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/mtg-companion/' : '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
  },
}))
