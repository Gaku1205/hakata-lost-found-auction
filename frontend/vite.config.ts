import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ローカル開発時のみ: VITE_API_PROXY にデプロイ済みAPIのURLを指定すると /api をプロキシする
const proxyTarget = process.env.VITE_API_PROXY;

export default defineConfig({
  plugins: [react()],
  server:
    proxyTarget !== undefined && proxyTarget !== ''
      ? {
          proxy: {
            '/api': { target: proxyTarget, changeOrigin: true },
          },
        }
      : {},
});
