import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  return {
    plugins: [react()],
    server: {
      port: Number(env.FRONTEND_PORT || 5175),
      strictPort: true,
      proxy: { '/api': { target: `http://127.0.0.1:${env.BACKEND_PORT || 8010}`, changeOrigin: true } },
    },
    build: { outDir: 'dist', sourcemap: false },
  };
});
