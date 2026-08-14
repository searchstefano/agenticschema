import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  // I pacchetti si referenziano per nome pubblico; in test si risolvono ai sorgenti,
  // così non serve una build prima di poter eseguire la suite.
  resolve: {
    alias: {
      '@agenticschema/core': pkg('core'),
      '@agenticschema/profiles': pkg('profiles'),
    },
  },
  test: {
    environment: 'node',
    // The corpus tooling lives in `scripts/`, outside any package, and is plain
    // JS: it is build-time machinery, not shipped code. Its pure parts are
    // tested here all the same, because a corpus you make claims about cannot
    // rest on an untested parser.
    include: ['packages/*/test/**/*.test.ts', 'scripts/**/*.test.mjs'],
    // Real pages are heavy: hundreds of them through happy-dom is minutes, not
    // seconds, and the default suite has to stay quick enough to run on every
    // save. `npm run test:corpus` is where those live.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.corpus.test.ts'],
  },
});
