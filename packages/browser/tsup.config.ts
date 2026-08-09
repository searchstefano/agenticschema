import { defineConfig } from 'tsup';

export default defineConfig([
  // Consumed through npm: core and profiles stay external for the app's bundler to resolve.
  {
    entry: ['src/index.ts', 'src/auto.ts'],
    format: ['esm'],
    clean: true,
  },
  // Consumed through a script tag, so this one has to stand on its own: a
  // browser cannot resolve bare specifiers.
  //
  // One file, no splitting. Chunks buy nothing here, because the profiles are
  // needed on every mapping and get fetched on every page anyway, and they cost
  // correctness: relative chunk imports resolve against the URL the entry was
  // served from, so the short CDN URL (/npm/@agenticschema/browser) looks for
  // them one directory too high and 404s.
  {
    entry: ['src/auto.ts'],
    format: ['esm'],
    outDir: 'dist/cdn',
    splitting: false,
    minify: true,
    noExternal: ['@agenticschema/core', '@agenticschema/profiles', '@mcp-b/webmcp-polyfill'],
  },
]);
