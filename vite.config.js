import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The base path is baked into the bundle at build time, so it must be the same
// for `dev`, `preview` and `build`. Setting it only for `build` (the obvious
// thing) breaks `vite preview`, which runs as a serve command and would host at
// `/` while the built HTML points at `/mtg-companion/` — leaving the production
// build impossible to check locally.
//
// Override with VITE_BASE when hosting somewhere other than GitHub Pages:
//   VITE_BASE=/ npm run build
export default defineConfig({
  base: process.env.VITE_BASE ?? '/mtg-companion/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
  },
})
