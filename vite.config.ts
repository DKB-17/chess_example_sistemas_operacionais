import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      // Em desenvolvimento (npm run dev) encaminha API e WebSocket para o servidor Node
      proxy: {
        '/api': 'http://localhost:3001',
        '/ws': { target: 'ws://localhost:3001', ws: true },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve('./src'),
      },
    },
  };
});
