import { defineConfig } from 'vite';

export default defineConfig({
  // The board photo lives in docs/, outside this package. It is only used
  // here, as a tracing underlay; the game itself never ships it.
  server: { fs: { allow: ['../..'] } },
  build: { target: 'es2022' },
});
