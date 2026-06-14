import { defineConfig } from 'vitest/config'

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: ['index.html', 'dev/assets/index.html'],
    },
  },
  optimizeDeps: {
    // Rapier ships WASM that Vite's pre-bundler cannot process
    exclude: ['@dimforge/rapier3d-compat'],
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
})
