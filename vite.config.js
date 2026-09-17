import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base, so the same build runs at any path — GitHub Pages under
// /mtg-companion/, a Cloudflare Pages root, or a file:// open — with no config
// change and no redeploy.
//
// The previous absolute base caused two separate bugs: `vite preview` runs as a
// serve command and hosted at / while the built HTML pointed elsewhere, and the
// 404 fallback had to hardcode the deploy path. Relative base removes the class.
//
// Set VITE_BASE to force an absolute base if a host ever needs one.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // React changes on its own schedule, the app on ours. Splitting them
        // means shipping a fix does not re-download the framework.
        manualChunks: (id) => (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)
          ? 'react'
          : undefined),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
  },
})
