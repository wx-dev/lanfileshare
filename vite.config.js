import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: '0.0.0.0',
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    // 浏览器直接打开 http://localhost:1420 调试时，接口转发到本机 HTTP 服务
    proxy: {
      '/api': { target: 'http://127.0.0.1:8081', xfwd: true },
      '/files': { target: 'http://127.0.0.1:8081', xfwd: true },
      '/share': { target: 'http://127.0.0.1:8081', xfwd: true },
      '/preview': { target: 'http://127.0.0.1:8081', xfwd: true },
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
