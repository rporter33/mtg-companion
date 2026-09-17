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
// Every build carries its commit and time, baked into the code as __BUILD__
// and written beside it as version.json. The two together let the running app
// say which build it is and notice when a newer one has been published — the
// question "did my change deploy?" used to be answered by guessing.
const BUILD = {
  sha: (process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local',
  at: new Date().toISOString(),
}
BUILD.id = BUILD.sha === 'local' ? `local-${BUILD.at}` : BUILD.sha

function versionFile() {
  return {
    name: 'version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(BUILD) })
    },
  }
}

export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [react(), versionFile()],
  define: { __BUILD__: JSON.stringify(BUILD) },
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
