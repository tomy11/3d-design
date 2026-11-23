import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    // The three core alone is about 590 kB and cannot be split further.
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        // Libraries change less often than the app, so they get their own cached files.
        // Only the three core goes here: its loaders and exporters stay split for lazy loading.
        manualChunks(id) {
          if (id.includes('/node_modules/three/build/')) return 'three'
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
        },
      },
    },
  },
})
