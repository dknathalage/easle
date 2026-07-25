import { defineConfig } from 'vitest/config';

// DB-layer tests (electron/**) run in node; renderer tests opt into jsdom with a
// per-file `// @vitest-environment jsdom` pragma.
export default defineConfig({
  test: {
    // globals:true exposes test/expect without importing 'vitest' (which is ESM-only
    // and cannot be require()d from our CommonJS electron/*.test.js files).
    globals: true,
    environment: 'node',
    include: ['electron/**/*.test.js', 'src/**/*.test.{ts,tsx}'],
  },
});
