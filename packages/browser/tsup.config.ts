import { defineConfig } from 'tsup';

export default defineConfig([
  // Consumo via npm: core e profiles restano esterni, li risolve il bundler dell'app.
  {
    entry: ['src/index.ts', 'src/auto.ts'],
    format: ['esm'],
    clean: true,
  },
  // Consumo via tag script: dev'essere autosufficiente, perché il browser non sa
  // risolvere gli specifier bare. `splitting` tiene i profili e il polyfill in
  // chunk separati, così il payload iniziale resta piccolo.
  {
    entry: ['src/auto.ts'],
    format: ['esm'],
    outDir: 'dist/cdn',
    splitting: true,
    minify: true,
    noExternal: ['@agenticschema/core', '@agenticschema/profiles', '@mcp-b/webmcp-polyfill'],
  },
]);
