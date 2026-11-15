import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The built output (web/dist) is served by FastAPI as static files.
// In dev, API calls under /api are proxied to the local uvicorn server.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    // The Methods page imports ../docs/methodology.md (a sibling of web/), so dev may read it.
    fs: { allow: [path.resolve(import.meta.dirname, '..')] },
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // Axe and the 100-run fast-check properties exceed the 5 s default when workers compete for CPU.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
