import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // The debug client loads the board photo from docs/ as a dev-only underlay;
  // production builds never include it.
  server: { fs: { allow: ['../..'] } },
  build: {
    target: 'es2022',
    // three.js alone is ~600 kB minified.
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        debug: resolve(import.meta.dirname, 'debug.html'),
      },
    },
  },
});
