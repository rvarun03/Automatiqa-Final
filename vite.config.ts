import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        watch: {
          ignored: ['**/dist/**', '**/.git/**', '**/node_modules/**', '**/.system_generated/**', '**/public/automatiqa-agent.js', '**/ai_cache_store.json']
        }
      },
      plugins: [react(), tailwindcss()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.API_KEY || "AIzaSyCmjRWkM3x25TGDPs4eIB1OZd_-qTK1jAU"),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.API_KEY || "AIzaSyCmjRWkM3x25TGDPs4eIB1OZd_-qTK1jAU")
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        sourcemap: false,
        minify: 'esbuild',
        reportCompressedSize: false,
        target: 'esnext'
      }
    };
});
