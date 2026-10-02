import * as path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: path.resolve(__dirname, 'src/ui'),
  base: './',
  plugins: [tailwindcss()],
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/ui'),
    },
  },
  build: {
    emptyOutDir: true,
    outDir: path.resolve(__dirname, 'dist/ui'),
    sourcemap: true,
  },
});
