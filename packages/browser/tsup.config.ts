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
  //
  // iife, not esm. A tag manager — Zaraz, Google Tag Manager — injects a plain
  // <script src> and never sets type="module", and an ESM bundle loaded that
  // way is a syntax error before any of it runs. An IIFE is valid both ways, so
  // one file serves the hand-written tag and the tag manager alike.
  {
    entry: ['src/auto.ts'],
    format: ['iife'],
    // tsup names an iife bundle `auto.global.js`. `unpkg`, `jsdelivr`, the size
    // check and every URL already in the wild all point at `auto.js`.
    outExtension: () => ({ js: '.js' }),
    globalName: 'agenticschema',
    outDir: 'dist/cdn',
    splitting: false,
    minify: true,
    noExternal: ['@agenticschema/core', '@agenticschema/profiles', '@mcp-b/webmcp-polyfill'],
  },
]);
