import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/**
 * The corpus suite: the pipeline against real pages from Common Crawl.
 *
 * Separate from `vitest.config.ts` because these are half-megabyte pages and
 * happy-dom is slow with them. The default suite runs in seconds and must keep
 * doing so; this one runs when you ask for it, with `npm run test:corpus`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@agenticschema/core': pkg('core'),
      '@agenticschema/profiles': pkg('profiles'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.corpus.test.ts'],
    // Parsing a megabyte of real markup is not a millisecond operation, and a
    // slow page must not be reported as a broken one.
    testTimeout: 60_000,
    // Real pages are heavy in memory as well as on disk. Running the files in
    // parallel multiplies the peak for no gain: the work is already one page
    // after another.
    fileParallelism: false,
  },
});
