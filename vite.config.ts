import * as path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: path.resolve(__dirname, 'src/ui'),
  base: './',
  build: {
    emptyOutDir: true,
    outDir: path.resolve(__dirname, 'dist/ui'),
    sourcemap: true,
  },
});
