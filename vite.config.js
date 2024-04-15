// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  css: {
    modules: true,
  },
  server: {
    watch: {
      include: 'src/**/*.js',
    },
  },
});