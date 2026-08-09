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
    include: ['packages/*/test/**/*.test.ts'],
  },
});
