import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  server: {
    port: 4800,
    host: '0.0.0.0',
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3210',
    },
  },
  build: {
    outDir: 'dist',
  },
});
