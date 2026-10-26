import { defineConfig } from 'vite';

export default defineConfig({
  // three.js alone is ~600 kB minified.
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
});
