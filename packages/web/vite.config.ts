import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    port: parseInt(process.env.CLIENT_PORT || '4000', 10),
    strictPort: true, // Don't auto-increment, fail if port in use
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.SERVER_PORT || '4001'}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://127.0.0.1:${process.env.SERVER_PORT || '4001'}`,
        ws: true,
      },
    },
  },
});
