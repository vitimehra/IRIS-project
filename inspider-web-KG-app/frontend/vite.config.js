import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The repo-root .env holds the ports. Vite only reads VITE_-prefixed keys
// itself, so the two we need are read here and handed to the dev server.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const backendPort = env.BACKEND_PORT || '8000';
  const frontendPort = Number(env.FRONTEND_PORT || 5174);
  return {
    plugins: [react()],
    server: {
      port: frontendPort,
      strictPort: true,
      proxy: { '/api': { target: `http://127.0.0.1:${backendPort}`, changeOrigin: true } },
    },
    build: { outDir: 'dist', sourcemap: false },
  };
});
