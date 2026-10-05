import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
