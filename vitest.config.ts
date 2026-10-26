import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{packages,apps,tools}/*/{src,test}/**/*.test.ts'],
  },
});
