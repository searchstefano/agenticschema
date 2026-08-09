import { defineConfig } from 'tsup';

export default defineConfig([
  // Consumed through npm: core and profiles stay external for the app's bundler to resolve.
  {
    entry: ['src/index.ts', 'src/auto.ts'],
    format: ['esm'],
    clean: true,
  },
  // Consumed through a script tag, so this one has to stand on its own: a
  // browser cannot resolve bare specifiers. `splitting` keeps the profiles and
  // the polyfill in separate chunks so the initial payload stays small.
  {
    entry: ['src/auto.ts'],
    format: ['esm'],
    outDir: 'dist/cdn',
    splitting: true,
    minify: true,
    noExternal: ['@agenticschema/core', '@agenticschema/profiles', '@mcp-b/webmcp-polyfill'],
  },
]);
