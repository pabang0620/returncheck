import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 6000 },
  server: {
    port: 5180,
    proxy: {
      '/api': 'http://localhost:3010',
      '/mock-paypal': 'http://localhost:3010',
    },
  },
})
